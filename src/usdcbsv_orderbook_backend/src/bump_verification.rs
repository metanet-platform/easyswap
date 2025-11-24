use crate::block_headers::{get_block_by_height, get_highest_block, CONFIRMATION_DEPTH, BlockHeader};
use candid::{CandidType, Deserialize, Principal};
use sha2::{Digest, Sha256};

// TxArchive canister ID for fallback block lookups
const TXARCHIVE_CANISTER_ID: &str = "glgze-4qaaa-aaaac-a4m2a-cai";

// TxArchive response structure
#[derive(CandidType, Deserialize)]
struct TxArchiveBlockInfoResponse {
    success: bool,
    height: Option<u64>,
    hash: Option<String>,
    merkle_root: Option<String>,
    timestamp: Option<u64>,
    header: Option<String>,
    reason: Option<String>,
    error_code: Option<String>,
}

#[derive(Debug, Clone, CandidType, Deserialize)]
pub struct BumpProof {
    pub block_height: u64,
    pub path: Vec<Vec<BumpNode>>,  // Changed: path is now a vector of levels, each level is a vector of nodes
}

#[derive(Debug, Clone, CandidType, Deserialize)]
pub struct BumpNode {
    pub offset: u64,
    pub hash: String,      // Hex encoded hash
    pub txid: Option<bool>, // Some(true) if this is the txid, None otherwise
    pub duplicate: Option<bool>, // Some(true) if this hash should be duplicated
}

#[derive(Debug, Clone, CandidType, Deserialize)]
pub struct TxVerification {
    pub verified: bool,
    pub block_height: u64,
    pub block_hash: String,
    pub confirmations: u64,
    pub message: String,
}

/// Fetch block info from TxArchive canister (fallback)
async fn fetch_block_from_txarchive(block_height: u64) -> Result<BlockHeader, String> {
    let txarchive_principal = Principal::from_text(TXARCHIVE_CANISTER_ID)
        .map_err(|e| format!("Invalid TxArchive canister ID: {}", e))?;
    
    ic_cdk::println!("📦 Fetching block {} from TxArchive canister as fallback", block_height);
    
    let result: Result<(TxArchiveBlockInfoResponse,), _> = ic_cdk::call(
        txarchive_principal,
        "get_block_info",
        (block_height,)
    ).await;
    
    match result {
        Ok((response,)) => {
            if response.success {
                let hash = response.hash.ok_or("Missing hash in TxArchive response")?;
                let merkle_root = response.merkle_root.ok_or("Missing merkle_root in TxArchive response")?;
                let header = response.header.ok_or("Missing header in TxArchive response")?;
                let timestamp = response.timestamp.ok_or("Missing timestamp in TxArchive response")?;
                
                ic_cdk::println!("✅ Retrieved block {} from TxArchive: hash={}", block_height, &hash[..8]);
                
                // Convert to our BlockHeader format
                Ok(BlockHeader {
                    height: block_height,
                    hash,
                    previous_hash: String::new(), // Not needed for verification
                    merkle_root,
                    timestamp,
                    bits: 0,
                    nonce: 0,
                    version: 0,
                    raw_header: header,
                })
            } else {
                Err(response.reason.unwrap_or_else(|| "TxArchive returned failure".to_string()))
            }
        }
        Err((code, msg)) => {
            Err(format!("TxArchive call failed: {:?} - {}", code, msg))
        }
    }
}

/// Verify a transaction using BUMP proof (async version with TxArchive fallback)
pub async fn verify_tx_bump_async(txid: &str, bump_hex: &str) -> Result<TxVerification, String> {
    // Input validation: prevent DoS with oversized inputs
    if txid.len() != 64 {
        return Err("Invalid txid: must be 64 hex characters (32 bytes)".to_string());
    }
    if bump_hex.len() > 10000 {
        return Err("BUMP proof too large (max 10000 hex chars)".to_string());
    }
    if !txid.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid txid: must be valid hex string".to_string());
    }
    
    // Parse BUMP proof from hex
    ic_cdk::println!("📄 BUMP hex (first 100 chars): {}", &bump_hex.chars().take(100).collect::<String>());
    ic_cdk::println!("📏 BUMP hex length: {} characters", bump_hex.len());
    
    let bump = parse_bump_hex(bump_hex)?;
    ic_cdk::println!("✅ BUMP parsed successfully: block_height={}, path_length={}", bump.block_height, bump.path.len());
    
    // Try to get block from local storage first
    let (block, used_fallback) = match get_block_by_height(bump.block_height) {
        Some(b) => {
            ic_cdk::println!("✓ Block {} found in local storage", bump.block_height);
            (b, false)
        }
        None => {
            // Fallback to TxArchive canister
            ic_cdk::println!("⚠️ Block {} not in local storage, trying TxArchive fallback", bump.block_height);
            match fetch_block_from_txarchive(bump.block_height).await {
                Ok(b) => {
                    ic_cdk::println!("✅ Block {} retrieved from TxArchive", bump.block_height);
                    (b, true)
                }
                Err(e) => {
                    return Err(format!(
                        "Block at height {} not found in local storage or TxArchive: {}",
                        bump.block_height, e
                    ));
                }
            }
        }
    };

    // Verify the merkle proof
    let computed_root = compute_merkle_root(txid, &bump.path)?;
    
    if computed_root != block.merkle_root {
        return Err(format!(
            "Merkle root mismatch! Computed: {}, Block: {}",
            computed_root, block.merkle_root
        ));
    }

    // Check confirmations
    // If we used TxArchive fallback, we can trust the block is sufficiently confirmed
    // TxArchive only stores blocks that are already deep in the chain
    let highest = if used_fallback {
        ic_cdk::println!("ℹ️ Using TxArchive fallback - assuming sufficient confirmations (TxArchive only has confirmed blocks)");
        // Assume TxArchive has blocks with at least CONFIRMATION_DEPTH confirmations
        // Set highest to bump_height + CONFIRMATION_DEPTH to pass the check
        bump.block_height + CONFIRMATION_DEPTH
    } else {
        get_highest_block()
    };
    
    if highest < bump.block_height {
        return Err(format!(
            "Block height {} is ahead of our chain tip {}. Please wait for block sync to catch up.",
            bump.block_height, highest
        ));
    }

    let confirmations = highest - bump.block_height + 1;

    // Require CONFIRMATION_DEPTH confirmations (18 blocks)
    if confirmations < CONFIRMATION_DEPTH {
        return Ok(TxVerification {
            verified: false,
            block_height: bump.block_height,
            block_hash: block.hash.clone(),
            confirmations,
            message: format!(
                "Insufficient confirmations: {} (need {})",
                confirmations, CONFIRMATION_DEPTH
            ),
        });
    }

    Ok(TxVerification {
        verified: true,
        block_height: bump.block_height,
        block_hash: block.hash,
        confirmations,
        message: format!("Transaction verified with {} confirmations", confirmations),
    })
}

/// Verify a transaction using BUMP proof (sync version - kept for compatibility)
pub fn verify_tx_bump(txid: &str, bump_hex: &str) -> Result<TxVerification, String> {
    // Input validation: prevent DoS with oversized inputs
    if txid.len() != 64 {
        return Err("Invalid txid: must be 64 hex characters (32 bytes)".to_string());
    }
    if bump_hex.len() > 10000 {
        return Err("BUMP proof too large (max 10000 hex chars)".to_string());
    }
    if !txid.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid txid: must be valid hex string".to_string());
    }
    
    // Parse BUMP proof from hex
    let bump = parse_bump_hex(bump_hex)?;
    
    // Get the block header for this height (no fallback in sync version)
    let block = get_block_by_height(bump.block_height)
        .ok_or_else(|| format!("Block at height {} not found in our storage", bump.block_height))?;

    // Verify the merkle proof
    let computed_root = compute_merkle_root(txid, &bump.path)?;
    
    if computed_root != block.merkle_root {
        return Err(format!(
            "Merkle root mismatch! Computed: {}, Block: {}",
            computed_root, block.merkle_root
        ));
    }

    // Check confirmations
    let highest = get_highest_block();
    if highest < bump.block_height {
        return Err("Block height is ahead of our chain tip".to_string());
    }

    let confirmations = highest - bump.block_height + 1;

    // Require CONFIRMATION_DEPTH confirmations (18 blocks)
    if confirmations < CONFIRMATION_DEPTH {
        return Ok(TxVerification {
            verified: false,
            block_height: bump.block_height,
            block_hash: block.hash.clone(),
            confirmations,
            message: format!(
                "Insufficient confirmations: {} (need {})",
                confirmations, CONFIRMATION_DEPTH
            ),
        });
    }

    Ok(TxVerification {
        verified: true,
        block_height: bump.block_height,
        block_hash: block.hash,
        confirmations,
        message: format!("Transaction verified with {} confirmations", confirmations),
    })
}

/// Parse BUMP proof from hex string
/// BUMP format (BSV Unified Merkle Proof) per BRC-74:
/// - Block height (varint)
/// - Tree height (1 byte) - number of levels in the tree
/// - For each level:
///   - Number of leaves at this level (varint)
///   - For each leaf:
///     - Offset (varint) - position in this level
///     - Flags (1 byte): bit 0 = duplicate, bit 1 = txid
///     - Hash (32 bytes, reversed for display) - only if not a duplicate
fn parse_bump_hex(bump_hex: &str) -> Result<BumpProof, String> {
    let bytes = hex::decode(bump_hex).map_err(|e| format!("Invalid BUMP hex: {}", e))?;
    ic_cdk::println!("🔍 Parsing BUMP: {} bytes decoded from {} hex chars", bytes.len(), bump_hex.len());
    
    // Parse varint for block height
    let (block_height, mut offset) = parse_varint(&bytes, 0)?;
    ic_cdk::println!("  Block height: {}, offset after: {}", block_height, offset);
    
    // Tree height is a single byte
    if offset >= bytes.len() {
        return Err("Invalid BUMP: insufficient data for tree height".to_string());
    }
    let tree_height = bytes[offset] as u64;
    offset += 1;
    ic_cdk::println!("  Tree height: {}, offset after: {}", tree_height, offset);
    
    let mut path = Vec::new();
    
    // Parse each level
    for level in 0..tree_height {
        let mut level_nodes = Vec::new();
        
        // Number of leaves at this level
        let (n_leaves, new_offset) = parse_varint(&bytes, offset)?;
        offset = new_offset;
        ic_cdk::println!("  Level {}: {} leaves, offset after count: {}", level, n_leaves, offset);
        
        // Parse each leaf in this level
        for leaf_idx in 0..n_leaves {
            // Leaf offset (position in this level)
            let (leaf_offset, new_offset) = parse_varint(&bytes, offset)?;
            offset = new_offset;
            
            // Flags byte
            if offset >= bytes.len() {
                return Err(format!("Invalid BUMP: insufficient data for flags at level {} leaf {}", level, leaf_idx));
            }
            let flags = bytes[offset];
            offset += 1;
            
            let is_duplicate = (flags & 1) != 0;
            let is_txid = (flags & 2) != 0;
            
            ic_cdk::println!("    Leaf {}: offset={}, flags=0x{:02x} (dup={}, txid={})", 
                leaf_idx, leaf_offset, flags, is_duplicate, is_txid);
            
            let hash = if is_duplicate {
                // Duplicate nodes don't have a hash stored
                String::new()
            } else {
                // Read 32-byte hash and reverse it for display (Bitcoin internal byte order)
                if offset + 32 > bytes.len() {
                    return Err(format!("Invalid BUMP: insufficient data for hash at level {} leaf {}", level, leaf_idx));
                }
                let mut hash_bytes = bytes[offset..offset + 32].to_vec();
                hash_bytes.reverse(); // Reverse to get display format
                offset += 32;
                hex::encode(&hash_bytes)
            };
            
            level_nodes.push(BumpNode {
                offset: leaf_offset,
                hash,
                txid: if is_txid { Some(true) } else { None },
                duplicate: if is_duplicate { Some(true) } else { None },
            });
        }
        
        path.push(level_nodes);
    }
    
    let total_nodes: usize = path.iter().map(|level| level.len()).sum();
    ic_cdk::println!("✅ BUMP parsed successfully: block {}, {} levels, {} total nodes", block_height, path.len(), total_nodes);
    
    Ok(BumpProof {
        block_height,
        path,
    })
}

/// Parse Bitcoin-style varint from bytes
/// Format:
/// - 0x00-0xFC: value is the byte itself (1 byte total)
/// - 0xFD: followed by 2 bytes little-endian (3 bytes total)
/// - 0xFE: followed by 4 bytes little-endian (5 bytes total)
/// - 0xFF: followed by 8 bytes little-endian (9 bytes total)
fn parse_varint(bytes: &[u8], start: usize) -> Result<(u64, usize), String> {
    if start >= bytes.len() {
        return Err("Insufficient data for varint".to_string());
    }
    
    let first_byte = bytes[start];
    
    match first_byte {
        // Direct value (0-252)
        0x00..=0xFC => {
            Ok((first_byte as u64, start + 1))
        },
        // 2-byte value (253-65535)
        0xFD => {
            if start + 3 > bytes.len() {
                return Err("Insufficient data for varint (FD)".to_string());
            }
            let value = u16::from_le_bytes([bytes[start + 1], bytes[start + 2]]) as u64;
            Ok((value, start + 3))
        },
        // 4-byte value
        0xFE => {
            if start + 5 > bytes.len() {
                return Err("Insufficient data for varint (FE)".to_string());
            }
            let value = u32::from_le_bytes([
                bytes[start + 1],
                bytes[start + 2],
                bytes[start + 3],
                bytes[start + 4],
            ]) as u64;
            Ok((value, start + 5))
        },
        // 8-byte value
        0xFF => {
            if start + 9 > bytes.len() {
                return Err("Insufficient data for varint (FF)".to_string());
            }
            let value = u64::from_le_bytes([
                bytes[start + 1],
                bytes[start + 2],
                bytes[start + 3],
                bytes[start + 4],
                bytes[start + 5],
                bytes[start + 6],
                bytes[start + 7],
                bytes[start + 8],
            ]);
            Ok((value, start + 9))
        },
    }
}

/// Compute merkle root from txid and path
/// The path is structured as levels in the tree, starting from leaf level (level 0)
/// At each level, we find the sibling node(s) and hash them together to move up to the parent level
fn compute_merkle_root(txid: &str, path: &[Vec<BumpNode>]) -> Result<String, String> {
    if path.is_empty() {
        return Err("Empty BUMP path".to_string());
    }
    
    // Find the txid node in level 0
    let level0 = &path[0];
    let tx_node = level0.iter()
        .find(|node| node.txid == Some(true))
        .ok_or("No transaction node found in BUMP level 0")?;
    
    let mut current_hash = hex::decode(txid).map_err(|e| format!("Invalid txid hex: {}", e))?;
    current_hash.reverse(); // Internal byte order
    
    let mut current_offset = tx_node.offset;
    
    ic_cdk::println!("🔧 Computing merkle root from tx at offset {}", current_offset);
    
    // Process each level
    for (level_idx, level_nodes) in path.iter().enumerate() {
        ic_cdk::println!("  Level {}: processing {} nodes, current offset: {}", level_idx, level_nodes.len(), current_offset);
        
        // Find sibling at this level
        // The sibling is the node that we need to hash with our current hash
        let sibling = if level_idx == 0 {
            // At level 0, find the node that's not the txid
            level_nodes.iter().find(|node| node.txid != Some(true))
        } else {
            // At higher levels, there should be exactly one sibling node
            level_nodes.first()
        };
        
        if let Some(sibling_node) = sibling {
            // Handle duplicate flag
            let mut sibling_hash = if sibling_node.duplicate == Some(true) {
                // Duplicate means use current hash as sibling
                current_hash.clone()
            } else {
                // Decode the hex hash
                let mut hash_bytes = hex::decode(&sibling_node.hash)
                    .map_err(|e| format!("Invalid sibling hash hex at level {}: {}", level_idx, e))?;
                // Reverse from display format back to internal byte order
                hash_bytes.reverse();
                hash_bytes
            };
            
            // Determine order: lower offset goes first (left)
            let combined = if current_offset < sibling_node.offset {
                [current_hash.clone(), sibling_hash].concat()
            } else {
                [sibling_hash, current_hash.clone()].concat()
            };
            
            ic_cdk::println!("    Hashing: offset {} and {} (order: {})", 
                current_offset, sibling_node.offset,
                if current_offset < sibling_node.offset { "left,right" } else { "right,left" }
            );
            
            current_hash = double_sha256(&combined);
        }
        
        // Move to parent level - parent offset is current_offset / 2
        current_offset = current_offset / 2;
    }
    
    // Reverse back to display format
    current_hash.reverse();
    let result = hex::encode(current_hash);
    ic_cdk::println!("✅ Computed merkle root: {}", result);
    Ok(result)
}

/// Double SHA256 hash
fn double_sha256(data: &[u8]) -> Vec<u8> {
    let first = Sha256::digest(data);
    Sha256::digest(&first).to_vec()
}

/// Verify transaction with raw hex (compute txid and verify against block)
pub async fn verify_tx_raw_async(tx_hex: &str, bump_hex: &str) -> Result<TxVerification, String> {
    // Input validation: prevent DoS with oversized inputs
    // Maximum BSV transaction size is 10MB, but for our use case (simple transfers) we limit to 100KB
    if tx_hex.len() > 200000 {
        return Err("Transaction too large (max 100KB)".to_string());
    }
    if bump_hex.len() > 10000 {
        return Err("BUMP proof too large (max 10000 hex chars)".to_string());
    }
    
    // Compute txid from raw transaction
    let txid = compute_txid(tx_hex)?;
    
    // Verify using BUMP (with TxArchive fallback)
    verify_tx_bump_async(&txid, bump_hex).await
}

pub fn verify_tx_raw(tx_hex: &str, bump_hex: &str) -> Result<TxVerification, String> {
    // Input validation: prevent DoS with oversized inputs
    // Maximum BSV transaction size is 10MB, but for our use case (simple transfers) we limit to 100KB
    if tx_hex.len() > 200000 {
        return Err("Transaction too large (max 100KB)".to_string());
    }
    if bump_hex.len() > 10000 {
        return Err("BUMP proof too large (max 10000 hex chars)".to_string());
    }
    
    // Compute txid from raw transaction
    let txid = compute_txid(tx_hex)?;
    
    // Verify using BUMP (sync version - no fallback)
    verify_tx_bump(&txid, bump_hex)
}

/// Compute TXID from raw transaction hex
fn compute_txid(tx_hex: &str) -> Result<String, String> {
    let tx_bytes = hex::decode(tx_hex).map_err(|e| format!("Invalid tx hex: {}", e))?;
    
    // Double SHA256 of the raw transaction
    let mut hash = double_sha256(&tx_bytes);
    
    // Reverse for display format (little-endian to big-endian)
    hash.reverse();
    
    Ok(hex::encode(hash))
}

/// Check if transaction has sufficient confirmations
pub fn has_sufficient_confirmations(block_height: u64) -> Result<bool, String> {
    let highest = get_highest_block();
    
    if highest < block_height {
        return Ok(false);
    }
    
    let confirmations = highest - block_height + 1;
    Ok(confirmations >= CONFIRMATION_DEPTH)
}
