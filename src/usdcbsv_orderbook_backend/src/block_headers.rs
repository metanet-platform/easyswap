use candid::{CandidType, Deserialize, Encode, Decode};
use ic_cdk::api::management_canister::http_request::{
    http_request, CanisterHttpRequestArgument, HttpHeader, HttpMethod, HttpResponse, TransformArgs,
    TransformContext,
};
use crate::state::{create_admin_event, MEMORY_MANAGER};
use crate::types::AdminEventType;
use serde::{Serialize};
use serde_json;
use std::cell::RefCell;
use std::borrow::Cow;
use sha2::{Sha256, Digest};
use ic_stable_structures::{StableBTreeMap, Storable};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::memory_manager::MemoryId;

// Re-export constants from config for backwards compatibility
pub use crate::config::{CONFIRMATION_DEPTH, SYNC_INTERVAL_SECONDS};

// BSV Block Header (80 bytes)
#[derive(Clone, Debug, CandidType, Serialize, Deserialize)]
pub struct BlockHeader {
    pub height: u64,
    pub hash: String,          // Block hash (hex)
    pub previous_hash: String, // Previous block hash (hex)
    pub merkle_root: String,   // Merkle root (hex)
    pub timestamp: u64,        // Block timestamp
    pub bits: u32,             // Difficulty target
    pub nonce: u32,            // Nonce
    pub version: i32,          // Block version
    pub raw_header: String,    // Raw 80-byte header (hex)
}

// Response structure with block metadata
#[derive(Clone, Debug, CandidType, Serialize, Deserialize)]
pub struct BlocksWithMetadata {
    pub blocks: Vec<BlockHeader>,
    pub oldest_height: u64,
    pub newest_height: u64,
    pub total_count: u64,
}

// Implement Storable for BlockHeader to use in stable storage
impl Storable for BlockHeader {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(Encode!(self).expect("Failed to encode BlockHeader"))
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(bytes.as_ref(), Self).expect("Failed to decode BlockHeader")
    }

    const BOUND: Bound = Bound::Unbounded;
}

type Memory = ic_stable_structures::memory_manager::VirtualMemory<ic_stable_structures::DefaultMemoryImpl>;

// Stable block storage - persists across upgrades
thread_local! {
    pub(crate) static BLOCK_HEADERS: RefCell<StableBTreeMap<u64, BlockHeader, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(7))),
        )
    );
    
    // Store highest block height and last sync time in a simple counter
    static BLOCK_METADATA: RefCell<(u64, u64)> = RefCell::new((0, 0)); // (highest_block, last_sync_time)
}

/// Get the most recent N blocks in descending order (newest first)
/// Limited to max 100 blocks to prevent abuse
/// Returns blocks with metadata about storage range
pub fn get_recent_blocks(count: u64) -> BlocksWithMetadata {
    // Limit maximum blocks returned to prevent DoS
    let safe_count = count.min(100);
    
    BLOCK_HEADERS.with(|headers| {
        let headers_map = headers.borrow();
        let blocks: Vec<BlockHeader> = headers_map
            .iter()
            .rev() // Start from highest blocks
            .take(safe_count as usize)
            .map(|(_, block)| block)
            .collect();
        
        // Get storage range
        let (oldest_height, newest_height) = get_stored_range();
        let total_count = headers_map.len() as u64;
        
        BlocksWithMetadata {
            blocks,
            oldest_height,
            newest_height,
            total_count,
        }
    })
}

/// Get block header by height
pub fn get_block_by_height(height: u64) -> Option<BlockHeader> {
    BLOCK_HEADERS.with(|headers| headers.borrow().get(&height))
}

/// Get block header by hash - O(n) scan through all blocks
pub fn get_block_by_hash(hash: &str) -> Option<BlockHeader> {
    BLOCK_HEADERS.with(|headers| {
        headers.borrow()
            .iter()
            .find(|(_, block)| block.hash == hash)
            .map(|(_, block)| block)
    })
}

/// Get highest stored block height
/// Scans the actual stable storage to find the highest block
pub fn get_highest_block() -> u64 {
    BLOCK_HEADERS.with(|headers| {
        headers.borrow()
            .last_key_value()
            .map(|(height, _)| height)
            .unwrap_or(0)
    })
}

/// Update the highest block height (called internally when storing blocks)
fn set_highest_block(height: u64) {
    BLOCK_METADATA.with(|meta| {
        let (_, last_sync) = *meta.borrow();
        *meta.borrow_mut() = (height, last_sync);
    });
}

/// Store a block header in stable storage
pub fn store_block(header: BlockHeader) {
    let height = header.height;

    BLOCK_HEADERS.with(|headers| {
        headers.borrow_mut().insert(height, header);
    });

    // Update highest block if needed
    let current_highest = get_highest_block();
    if height > current_highest {
        set_highest_block(height);
    }
}

/// Remove blocks from a certain height onwards (for reorg handling)
pub fn remove_blocks_from(height: u64) {
    BLOCK_HEADERS.with(|headers| {
        let mut headers_map = headers.borrow_mut();
        let heights_to_remove: Vec<u64> = headers_map
            .range(height..)
            .map(|(h, _)| h)
            .collect();

        for h in heights_to_remove {
            headers_map.remove(&h);
        }
    });

    // Update highest block
    if get_highest_block() >= height {
        set_highest_block(height.saturating_sub(1));
    }
}

/// Validate block chain from start_height to end_height
pub fn validate_chain(start_height: u64, end_height: u64) -> Result<(), String> {
    if start_height >= end_height {
        return Err("Invalid height range".to_string());
    }

    for height in start_height..=end_height {
        let current = get_block_by_height(height)
            .ok_or_else(|| {
                let error_msg = format!("Block at height {} not found", height);
                create_admin_event(AdminEventType::BlockInsertionError {
                    block_height: height,
                    error_message: error_msg.clone(),
                });
                error_msg
            })?;

        if height > start_height {
            let previous = get_block_by_height(height - 1)
                .ok_or_else(|| {
                    let error_msg = format!("Previous block at height {} not found", height - 1);
                    create_admin_event(AdminEventType::BlockInsertionError {
                        block_height: height,
                        error_message: error_msg.clone(),
                    });
                    error_msg
                })?;

            // Verify previous hash linkage
            if current.previous_hash != previous.hash {
                let error_msg = format!(
                    "Chain broken at height {}: expected previous_hash {}, got {}",
                    height, previous.hash, current.previous_hash
                );
                create_admin_event(AdminEventType::BlockInsertionError {
                    block_height: height,
                    error_message: error_msg.clone(),
                });
                return Err(error_msg);
            }
        }

        // Verify block hash is valid (hash of header should match block hash)
        if !verify_block_hash(&current) {
            let error_msg = format!("Invalid block hash at height {}", height);
            create_admin_event(AdminEventType::BlockInsertionError {
                block_height: height,
                error_message: error_msg.clone(),
            });
            return Err(error_msg);
        }
    }

    Ok(())
}

/// Verify that the block hash matches the header data
/// Computes SHA256(SHA256(raw_header)) and compares with block hash
fn verify_block_hash(header: &BlockHeader) -> bool {
    // Verify block hash is valid hex string and raw_header is correct length (80 bytes = 160 hex chars)
    if header.hash.is_empty() || header.raw_header.len() != 160 {
        return false;
    }
    
    // Decode raw header from hex
    let raw_bytes = match hex::decode(&header.raw_header) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    
    if raw_bytes.len() != 80 {
        return false;
    }
    
    // Compute double SHA256: SHA256(SHA256(raw_header))
    let first_hash = Sha256::digest(&raw_bytes);
    let second_hash = Sha256::digest(&first_hash);
    
    // Bitcoin uses little-endian byte order for block hashes
    // So we need to reverse the bytes for display format
    let mut hash_bytes = second_hash.to_vec();
    hash_bytes.reverse();
    
    // Convert to hex string
    let computed_hash = hex::encode(hash_bytes);
    
    // Compare with the provided hash (case-insensitive)
    computed_hash.eq_ignore_ascii_case(&header.hash)
}

/// Update last sync time
pub fn update_sync_time(time: u64) {
    BLOCK_METADATA.with(|meta| {
        let (highest, _) = *meta.borrow();
        *meta.borrow_mut() = (highest, time);
    });
}

/// Get last sync time
pub fn get_last_sync_time() -> u64 {
    BLOCK_METADATA.with(|meta| meta.borrow().1)
}

/// Check if sync is needed
pub fn should_sync(current_time: u64) -> bool {
    let last_sync = get_last_sync_time();
    current_time >= last_sync + SYNC_INTERVAL_SECONDS
}

/// Get block count
pub fn get_block_count() -> usize {
    BLOCK_HEADERS.with(|headers| headers.borrow().len() as usize)
}

/// Get height range of stored blocks
pub fn get_stored_range() -> (u64, u64) {
    BLOCK_HEADERS.with(|headers| {
        let map = headers.borrow();
        if map.is_empty() {
            (0, 0)
        } else {
            let min = map.iter().next().map(|(h, _)| h).unwrap_or(0);
            let max = map.iter().next_back().map(|(h, _)| h).unwrap_or(0);
            (min, max)
        }
    })
}
