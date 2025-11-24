use crate::block_headers::*;
use crate::block_sync::*;
use crate::state::create_admin_event;
use crate::types::AdminEventType;
use crate::config::MAX_BLOCKS_TO_KEEP;
use candid::{CandidType, Deserialize};
use std::cell::RefCell;

thread_local! {
    static SYNC_IN_PROGRESS: RefCell<bool> = RefCell::new(false);
}

#[derive(Debug, Clone, CandidType, Deserialize)]
pub struct SyncResult {
    pub success: bool,
    pub blocks_added: u64,
    pub blocks_removed: u64,
    pub new_tip_height: u64,
    pub new_tip_hash: String,
    pub message: String,
}

/// Main synchronization function
/// Fetches new blocks, handles reorgs, validates chain
pub async fn sync_blocks() -> Result<SyncResult, String> {
    // Prevent concurrent syncs (protection against spam/DoS)
    let already_syncing = SYNC_IN_PROGRESS.with(|flag| {
        let mut flag = flag.borrow_mut();
        if *flag {
            true
        } else {
            *flag = true;
            false
        }
    });
    
    if already_syncing {
        return Err("Sync already in progress. Please wait.".to_string());
    }
    
    // Track cycles cost
    let cycles_start = ic_cdk::api::canister_balance128();
    
    // Ensure flag is cleared on any exit path
    let result = sync_blocks_internal().await;
    SYNC_IN_PROGRESS.with(|flag| *flag.borrow_mut() = false);
    
    // Log cycles consumed
    let cycles_end = ic_cdk::api::canister_balance128();
    let cycles_consumed = cycles_start.saturating_sub(cycles_end);
    ic_cdk::println!(
        "💰 Block sync consumed {} cycles ({:.2} T cycles)",
        cycles_consumed,
        cycles_consumed as f64 / 1_000_000_000_000.0
    );
    
    result
}

/// Internal sync logic
async fn sync_blocks_internal() -> Result<SyncResult, String> {
    ic_cdk::println!("Starting block synchronization...");
    
    // Step 1: Find consensus tip between WoC and Bitails (with retry)
    let consensus_result = match find_consensus_tip().await {
        Ok(result) => result,
        Err(e) => {
            ic_cdk::println!("⚠️ Failed to find consensus tip: {}", e);
            ic_cdk::println!("Will retry on next sync cycle");
            create_admin_event(AdminEventType::BlockInsertionError {
                block_height: get_highest_block(),
                error_message: format!("Consensus tip fetch failed: {}", e),
            });
            return Err(format!("Consensus tip fetch failed: {}. Will retry on next cycle.", e));
        }
    };
    
    let consensus_tip = consensus_result.tip.clone();
    let use_txarchive = consensus_result.use_txarchive_fallback;
    
    ic_cdk::println!(
        "Consensus tip: height={}, hash={}, source={}",
        consensus_tip.height,
        &consensus_tip.hash[..8],
        if use_txarchive { "TxArchive" } else { "APIs" }
    );

    // Step 2: Get our current highest block
    let our_highest = get_highest_block();
    ic_cdk::println!("Our highest block: {}", our_highest);

    // If we have no blocks, do initial sync
    if our_highest == 0 {
        return initial_sync(consensus_result).await;
    }

    // Step 3: Check if we need to handle a reorg
    let reorg_result = check_and_handle_reorg(&consensus_tip).await?;
    
    if reorg_result.reorg_detected {
        ic_cdk::println!(
            "Reorg detected! Rolled back from {} to {}",
            our_highest,
            reorg_result.valid_height
        );
    }

    // Step 4: Handle reorg continuation if needed
    if reorg_result.needs_continuation {
        // Reorg is deeper than one batch - return and let next sync call continue
        return Ok(SyncResult {
            success: true,
            blocks_added: 0,
            blocks_removed: reorg_result.blocks_removed,
            new_tip_height: get_highest_block(),
            new_tip_hash: String::new(), // Don't have final hash yet
            message: format!(
                "Reorg detection in progress: {} blocks checked. Call sync again to continue.",
                reorg_result.blocks_removed
            ),
        });
    }

    // Step 5: Fetch and add new blocks from valid height to consensus tip
    let start_height = reorg_result.valid_height + 1;
    let blocks_to_fetch = if consensus_tip.height >= start_height {
        consensus_tip.height - start_height + 1
    } else {
        0
    };

    if blocks_to_fetch == 0 {
        return Ok(SyncResult {
            success: true,
            blocks_added: 0,
            blocks_removed: reorg_result.blocks_removed,
            new_tip_height: get_highest_block(),
            new_tip_hash: consensus_tip.hash,
            message: "Already up to date".to_string(),
        });
    }

    ic_cdk::println!(
        "Fetching {} blocks from {} to {} (source: {})",
        blocks_to_fetch,
        start_height,
        consensus_tip.height,
        if use_txarchive { "TxArchive" } else { "APIs" }
    );

    let mut blocks_added = 0;
    
    // Choose data source based on fallback mode
    if use_txarchive {
        // TXARCHIVE FALLBACK MODE: Fetch from TxArchive
        ic_cdk::println!("📦 Using TxArchive as block data source");
        
        // Get our local tip for chain continuity validation
        let local_tip = if reorg_result.valid_height > 0 {
            get_block_by_height(reorg_result.valid_height)
                .map(|b| (b.height, b.hash))
        } else {
            None
        };
        
        // Fetch blocks from TxArchive (handles chain validation automatically)
        let txarchive_blocks = fetch_blocks_from_txarchive(consensus_tip.height, local_tip).await?;
        
        ic_cdk::println!("📥 Received {} blocks from TxArchive", txarchive_blocks.len());
        
        // Store blocks (they're already validated by fetch_blocks_from_txarchive)
        for header in txarchive_blocks {
            let height = header.height;
            
            // Double-check linkage before storing (extra safety)
            if height > start_height {
                if let Some(prev_block) = get_block_by_height(height - 1) {
                    if header.previous_hash != prev_block.hash {
                        let error_msg = format!(
                            "Chain linkage broken at height {}: expected previous_hash {}, got {}",
                            height, prev_block.hash, header.previous_hash
                        );
                        create_admin_event(AdminEventType::BlockInsertionError {
                            block_height: height,
                            error_message: error_msg.clone(),
                        });
                        return Err(error_msg);
                    }
                }
            }
            
            store_block(header);
            blocks_added += 1;
        }
    } else {
        // NORMAL MODE: Fetch from Bitails pagination API
        ic_cdk::println!("📡 Using API as block data source");
        const BATCH_SIZE: u64 = 20;
        
        let blocks_from_tip = consensus_tip.height - start_height + 1;
        let mut skip = 0u64;
        
        while skip < blocks_from_tip {
            let limit = std::cmp::min(BATCH_SIZE, blocks_from_tip - skip);
            
            ic_cdk::println!("Fetching batch: skip={}, limit={}", skip, limit);
            
            // Fetch batch from Bitails using pagination (descending order from tip)
            let batch = fetch_bitails_blocks_batch(skip, limit).await?;
            
            // Bitails returns in descending order, so reverse for storage
            let mut sorted_batch = batch;
            sorted_batch.sort_by_key(|h| h.height);
            
            // Validate and store batch in order
            for header in sorted_batch {
                let height = header.height;
                
                // Validate linkage before storing
                if height > start_height {
                    if let Some(prev_block) = get_block_by_height(height - 1) {
                        if header.previous_hash != prev_block.hash {
                            let error_msg = format!(
                                "Chain linkage broken at height {}: expected previous_hash {}, got {}",
                                height, prev_block.hash, header.previous_hash
                            );
                            create_admin_event(AdminEventType::BlockInsertionError {
                                block_height: height,
                                error_message: error_msg.clone(),
                            });
                            return Err(error_msg);
                        }
                    }
                }
                
                store_block(header);
                blocks_added += 1;
            }
            
            skip += limit;
            ic_cdk::println!("✓ Batch complete: {} blocks stored so far", blocks_added);
        }
    }

    // Step 6: Validate the chain from start_height
    validate_chain(start_height, consensus_tip.height)?;

    ic_cdk::println!(
        "Sync complete! Added {} blocks, removed {} blocks",
        blocks_added,
        reorg_result.blocks_removed
    );

    Ok(SyncResult {
        success: true,
        blocks_added,
        blocks_removed: reorg_result.blocks_removed,
        new_tip_height: get_highest_block(),
        new_tip_hash: consensus_tip.hash,
        message: format!(
            "Successfully synced {} new blocks from {}",
            blocks_added,
            if use_txarchive { "TxArchive" } else { "APIs" }
        ),
    })
}

/// Initial synchronization - fetches last MAX_BLOCKS_TO_KEEP blocks from tip
async fn initial_sync(consensus_result: ConsensusResult) -> Result<SyncResult, String> {
    let consensus_tip = consensus_result.tip.clone();
    let use_txarchive = consensus_result.use_txarchive_fallback;
    
    // Calculate target: fetch last MAX_BLOCKS_TO_KEEP blocks (default 720)
    let target_start_height = consensus_tip.height.saturating_sub(MAX_BLOCKS_TO_KEEP - 1);
    
    ic_cdk::println!(
        "Performing initial sync: fetching last {} blocks (from {} to {})",
        MAX_BLOCKS_TO_KEEP,
        target_start_height,
        consensus_tip.height
    );

    let total_blocks = consensus_tip.height - target_start_height + 1;
    ic_cdk::println!("Total blocks to fetch: {}", total_blocks);
    
    // Verify we're fetching the right amount (should equal MAX_BLOCKS_TO_KEEP or be close to it)
    if total_blocks > MAX_BLOCKS_TO_KEEP + 10 {
        // Something is wrong with the calculation
        let error_msg = format!(
            "Initial sync calculation error: trying to fetch {} blocks, but MAX_BLOCKS_TO_KEEP is {}",
            total_blocks, MAX_BLOCKS_TO_KEEP
        );
        create_admin_event(AdminEventType::BlockInsertionError {
            block_height: target_start_height,
            error_message: error_msg.clone(),
        });
        return Err(error_msg);
    }

    let mut all_blocks = Vec::new();
    
    ic_cdk::println!(
        "📥 Fetching blocks from {} to {} (source: {})...",
        target_start_height,
        consensus_tip.height,
        if use_txarchive { "TxArchive" } else { "APIs" }
    );
    
    if use_txarchive {
        // TXARCHIVE FALLBACK MODE for initial sync
        ic_cdk::println!("� Using TxArchive for initial sync");
        all_blocks = fetch_blocks_from_txarchive(consensus_tip.height, None).await?;
        
        // Filter to only keep blocks from target_start_height to consensus_tip
        all_blocks.retain(|b| b.height >= target_start_height && b.height <= consensus_tip.height);
        all_blocks.sort_by_key(|b| b.height);
        
    } else {
        // NORMAL API MODE for initial sync
        const BATCH_SIZE: u64 = 20;
        let mut skip = 0u64;
        
        // Keep fetching until we have the block at target_start_height
        loop {
            // Safety check: prevent unbounded iterations  
            // We should never need more than MAX_BLOCKS_TO_KEEP blocks
            if all_blocks.len() >= (MAX_BLOCKS_TO_KEEP + 100) as usize {
                let error_msg = format!("Safety limit reached: {} blocks fetched (max: {})", all_blocks.len(), MAX_BLOCKS_TO_KEEP);
                create_admin_event(AdminEventType::BlockInsertionError {
                    block_height: consensus_tip.height,
                    error_message: error_msg.clone(),
                });
                return Err(error_msg);
            }
            
            ic_cdk::println!("Fetching batch: skip={}, limit={}", skip, BATCH_SIZE);
            
            let batch = fetch_bitails_blocks_batch(skip, BATCH_SIZE).await?;
            
            if batch.is_empty() {
                let error_msg = "No more blocks returned from Bitails".to_string();
                create_admin_event(AdminEventType::BlockInsertionError {
                    block_height: consensus_tip.height,
                    error_message: error_msg.clone(),
                });
                return Err(error_msg);
            }
            
            let lowest_height = batch.iter().map(|b| b.height).min().unwrap_or(u64::MAX);
            ic_cdk::println!("Received {} blocks, lowest height: {}", batch.len(), lowest_height);
            
            // Add blocks to our collection
            all_blocks.extend(batch);
            
            // Stop if we've reached target_start_height or below
            if lowest_height <= target_start_height {
                ic_cdk::println!("✅ Reached target height {}", target_start_height);
                break;
            }
            
            skip += BATCH_SIZE;
        }
        
        // Filter to only keep blocks from target_start_height to consensus_tip
        all_blocks.retain(|b| b.height >= target_start_height && b.height <= consensus_tip.height);
        
        // Sort by height (ascending)
        all_blocks.sort_by_key(|b| b.height);
    }
    
    ic_cdk::println!("📦 Collected {} blocks total", all_blocks.len());
    
    // Validate chain integrity
    ic_cdk::println!("🔍 Validating chain linkage...");
    for i in 1..all_blocks.len() {
        let prev = &all_blocks[i - 1];
        let curr = &all_blocks[i];
        
        if curr.previous_hash != prev.hash {
            let error_msg = format!(
                "Chain broken at height {}: expected previous_hash {}, got {}",
                curr.height, prev.hash, curr.previous_hash
            );
            create_admin_event(AdminEventType::BlockInsertionError {
                block_height: curr.height,
                error_message: error_msg.clone(),
            });
            return Err(error_msg);
        }
    }
    ic_cdk::println!("✅ Chain validated successfully");
    
    // Store all blocks
    let blocks_added = all_blocks.len() as u64;
    for header in all_blocks {
        store_block(header);
    }

    ic_cdk::println!("✅ Initial sync complete! {} blocks added", blocks_added);

    Ok(SyncResult {
        success: true,
        blocks_added,
        blocks_removed: 0,
        new_tip_height: get_highest_block(),
        new_tip_hash: consensus_tip.hash,
        message: format!("Initial sync completed with {} blocks", blocks_added),
    })
}

#[derive(Debug)]
struct ReorgResult {
    reorg_detected: bool,
    valid_height: u64,
    blocks_removed: u64,
    needs_continuation: bool, // True if we hit batch limit and need to continue checking
}

/// Check for reorg and handle it
/// Returns needs_continuation=true if reorg is deeper than one batch can handle
async fn check_and_handle_reorg(_consensus_tip: &BlockInfo) -> Result<ReorgResult, String> {
    use crate::config::{MAX_BLOCKS_TO_KEEP, MAX_REORG_CHECK_PER_CALL};
    
    let our_highest = get_highest_block();
    
    // Fetch the block at our highest from Bitails
    let bitails_block = fetch_bitails_block_header(our_highest).await?;
    
    // Get our stored block at that height
    let our_block = get_block_by_height(our_highest)
        .ok_or_else(|| format!("Our block at height {} not found", our_highest))?;

    // If hashes match, no reorg
    if bitails_block.hash == our_block.hash {
        return Ok(ReorgResult {
            reorg_detected: false,
            valid_height: our_highest,
            blocks_removed: 0,
            needs_continuation: false,
        });
    }

    ic_cdk::println!(
        "⚠️ REORG DETECTED at height {}! Our hash: {}, Bitails hash: {}",
        our_highest,
        &our_block.hash[..8],
        &bitails_block.hash[..8]
    );

    // Walk backwards to find where our chain matches Bitails
    let mut check_height = our_highest - 1;
    let mut blocks_checked = 1; // Already checked highest
    
    // Calculate the minimum height we keep (for safety check)
    let min_height_to_keep = our_highest.saturating_sub(MAX_BLOCKS_TO_KEEP);

    loop {
        // Check if we've hit the per-call batch limit
        if blocks_checked >= MAX_REORG_CHECK_PER_CALL {
            ic_cdk::println!(
                "⏸️ Reorg check batch limit reached ({} blocks). Removing invalid blocks and will continue next call.",
                MAX_REORG_CHECK_PER_CALL
            );
            
            // Remove all blocks from check_height+1 upwards
            remove_blocks_from(check_height + 1);
            
            return Ok(ReorgResult {
                reorg_detected: true,
                valid_height: check_height,
                blocks_removed: blocks_checked,
                needs_continuation: true, // Signal that we need to continue checking
            });
        }
        
        // Absolute safety: prevent checking deeper than MAX_BLOCKS_TO_KEEP
        let total_depth = our_highest - check_height;
        if total_depth >= MAX_BLOCKS_TO_KEEP {
            return Err(format!(
                "CRITICAL: Reorg exceeds maximum depth of {} blocks. This indicates a deep chain split. Manual intervention required.",
                MAX_BLOCKS_TO_KEEP
            ));
        }
        
        if check_height < min_height_to_keep {
            return Err(format!(
                "Reorg went below minimum kept block height {} - chain data incomplete",
                min_height_to_keep
            ));
        }

        let bitails_block = fetch_bitails_block_header(check_height).await?;
        let our_block = get_block_by_height(check_height)
            .ok_or_else(|| format!("Our block at height {} not found", check_height))?;

        if bitails_block.hash == our_block.hash {
            ic_cdk::println!(
                "✅ Found common ancestor at height {}: hash={}",
                check_height,
                &our_block.hash[..8]
            );
            
            // Remove all blocks above this height
            remove_blocks_from(check_height + 1);
            
            return Ok(ReorgResult {
                reorg_detected: true,
                valid_height: check_height,
                blocks_removed: blocks_checked,
                needs_continuation: false, // Found the fork point
            });
        }

        blocks_checked += 1;
        check_height -= 1;
    }
}

/// Get sync status
pub fn get_sync_status() -> SyncStatus {
    let (min, max) = get_stored_range();
    let is_syncing = SYNC_IN_PROGRESS.with(|flag| *flag.borrow());
    
    SyncStatus {
        highest_block: get_highest_block(),
        block_count: get_block_count(),
        min_stored_height: min,
        max_stored_height: max,
        last_sync_time: get_last_sync_time(),
        is_syncing,
    }
}

#[derive(Debug, Clone, CandidType, Deserialize)]
pub struct SyncStatus {
    pub highest_block: u64,
    pub block_count: usize,
    pub min_stored_height: u64,
    pub max_stored_height: u64,
    pub last_sync_time: u64,
    pub is_syncing: bool,
}
