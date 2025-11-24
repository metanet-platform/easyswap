use crate::block_headers::{BlockHeader, CONFIRMATION_DEPTH};
use candid::{CandidType, Deserialize, Principal};
use ic_cdk::api::management_canister::http_request::{
    http_request, CanisterHttpRequestArgument, HttpHeader, HttpMethod, HttpResponse, TransformArgs,
    TransformContext,
};
use serde_json::{json, Value};

// Response structures
#[derive(Debug, Clone, CandidType, Deserialize)]
pub struct BlockInfo {
    pub height: u64,
    pub hash: String,
}

/// Fetch tip height from WoC
pub async fn fetch_woc_tip() -> Result<BlockInfo, String> {
    let url = "https://api.whatsonchain.com/v1/bsv/main/chain/info";
    
    let request = CanisterHttpRequestArgument {
        url: url.to_string(),
        method: HttpMethod::GET,
        body: None,
        max_response_bytes: Some(10_000),
        transform: Some(TransformContext::from_name(
            "transform_http_response".to_string(),
            vec![],
        )),
        headers: vec![],
    };

    match http_request(request, 25_000_000_000).await {
        Ok((response,)) => {
            if response.status != 200u64 {
                return Err(format!("WoC API error: status {}", response.status));
            }

            let body_str = String::from_utf8(response.body)
                .map_err(|e| format!("Failed to parse response body: {}", e))?;

            let json: Value = serde_json::from_str(&body_str)
                .map_err(|e| format!("Failed to parse JSON: {}", e))?;

            let height = json["blocks"]
                .as_u64()
                .ok_or("Missing 'blocks' field")?;

            let hash = json["bestblockhash"]
                .as_str()
                .ok_or("Missing 'bestblockhash' field")?
                .to_string();

            Ok(BlockInfo { height, hash })
        }
        Err((code, msg)) => Err(format!("HTTP request failed: {:?} - {}", code, msg)),
    }
}

/// Fetch tip height from Bitails using block list endpoint
pub async fn fetch_bitails_tip() -> Result<BlockInfo, String> {
    let url = "https://api.bitails.io/block/list?skip=0&limit=1&sort=height&direction=desc";
    
    let request = CanisterHttpRequestArgument {
        url: url.to_string(),
        method: HttpMethod::GET,
        body: None,
        max_response_bytes: Some(10_000),
        transform: Some(TransformContext::from_name(
            "transform_http_response".to_string(),
            vec![],
        )),
        headers: vec![],
    };

    match http_request(request, 25_000_000_000).await {
        Ok((response,)) => {
            if response.status != 200u64 {
                return Err(format!("Bitails API error: status {}", response.status));
            }

            let body_str = String::from_utf8(response.body)
                .map_err(|e| format!("Failed to parse response body: {}", e))?;

            let json: Value = serde_json::from_str(&body_str)
                .map_err(|e| format!("Failed to parse JSON: {}", e))?;

            // Response is an array, get first element
            let block = json.as_array()
                .and_then(|arr| arr.first())
                .ok_or("Empty block list response")?;

            let height = block["height"]
                .as_u64()
                .ok_or("Missing 'height' field")?;

            let hash = block["hash"]
                .as_str()
                .ok_or("Missing 'hash' field")?
                .to_string();

            Ok(BlockInfo { height, hash })
        }
        Err((code, msg)) => Err(format!("HTTP request failed: {:?} - {}", code, msg)),
    }
}

/// Fetch block header by hash from WoC
pub async fn fetch_woc_block_header(block_hash: &str) -> Result<BlockHeader, String> {
    let url = format!(
        "https://api.whatsonchain.com/v1/bsv/main/block/hash/{}/header",
        block_hash
    );
    
    let request = CanisterHttpRequestArgument {
        url: url.to_string(),
        method: HttpMethod::GET,
        body: None,
        max_response_bytes: Some(10_000),
        transform: Some(TransformContext::from_name(
            "transform_http_response".to_string(),
            vec![],
        )),
        headers: vec![],
    };

    match http_request(request, 25_000_000_000).await {
        Ok((response,)) => {
            if response.status != 200u64 {
                return Err(format!("WoC API error: status {}", response.status));
            }

            let body_str = String::from_utf8(response.body)
                .map_err(|e| format!("Failed to parse response body: {}", e))?;

            let json: Value = serde_json::from_str(&body_str)
                .map_err(|e| format!("Failed to parse JSON: {}", e))?;

            parse_woc_header(&json)
        }
        Err((code, msg)) => Err(format!("HTTP request failed: {:?} - {}", code, msg)),
    }
}

/// Fetch block header by height from WoC
pub async fn fetch_woc_block_header_by_height(height: u64) -> Result<BlockHeader, String> {
    let url = format!(
        "https://api.whatsonchain.com/v1/bsv/main/block/height/{}",
        height
    );
    
    let request = CanisterHttpRequestArgument {
        url: url.to_string(),
        method: HttpMethod::GET,
        body: None,
        max_response_bytes: Some(10_000),
        transform: Some(TransformContext::from_name(
            "transform_http_response".to_string(),
            vec![],
        )),
        headers: vec![],
    };

    match http_request(request, 25_000_000_000).await {
        Ok((response,)) => {
            if response.status != 200u64 {
                return Err(format!("WoC API error: status {}", response.status));
            }

            let body_str = String::from_utf8(response.body)
                .map_err(|e| format!("Failed to parse response body: {}", e))?;

            let json: Value = serde_json::from_str(&body_str)
                .map_err(|e| format!("Failed to parse JSON: {}", e))?;

            parse_woc_header(&json)
        }
        Err((code, msg)) => Err(format!("HTTP request failed: {:?} - {}", code, msg)),
    }
}

/// Fetch block header by height from Bitails using pagination
/// This uses the list endpoint which is more reliable for consensus
pub async fn fetch_bitails_block_header(height: u64) -> Result<BlockHeader, String> {
    // For single block, just fetch from tip and search
    // This is not efficient but works for consensus checking
    let headers = fetch_bitails_blocks_batch(0, 50).await?;
    headers.into_iter()
        .find(|h| h.height == height)
        .ok_or_else(|| format!("Block {} not found in recent blocks", height))
}

/// Fetch a batch of blocks from Bitails using pagination
/// skip: number of blocks to skip from tip (0 = latest block)
/// count: number of blocks to fetch
pub async fn fetch_bitails_blocks_batch(skip: u64, count: u64) -> Result<Vec<BlockHeader>, String> {
    let url = format!(
        "https://api.bitails.io/block/list?skip={}&limit={}&sort=height&direction=desc",
        skip, count
    );
    
    let request = CanisterHttpRequestArgument {
        url: url.to_string(),
        method: HttpMethod::GET,
        body: None,
        max_response_bytes: Some(100_000), // Larger for batch
        transform: Some(TransformContext::from_name(
            "transform_http_response".to_string(),
            vec![],
        )),
        headers: vec![],
    };

    match http_request(request, 25_000_000_000).await {
        Ok((response,)) => {
            if response.status != 200u64 {
                return Err(format!("Bitails API error: status {}", response.status));
            }

            let body_str = String::from_utf8(response.body)
                .map_err(|e| format!("Failed to parse response body: {}", e))?;

            let json: Value = serde_json::from_str(&body_str)
                .map_err(|e| format!("Failed to parse JSON: {}", e))?;

            let array = json.as_array()
                .ok_or("Expected array response from Bitails")?;

            let mut headers = Vec::new();
            for item in array {
                if let Ok(header) = parse_bitails_header(item, 0) {
                    headers.push(header);
                }
            }

            Ok(headers)
        }
        Err((code, msg)) => Err(format!("HTTP request failed: {:?} - {}", code, msg)),
    }
}

/// Fetch multiple block headers from Bitails by height range
pub async fn fetch_bitails_blocks_range(start: u64, end: u64) -> Result<Vec<BlockHeader>, String> {
    let mut headers = Vec::new();
    
    // Fetch in batches to avoid overwhelming the API
    for height in start..=end {
        match fetch_bitails_block_header(height).await {
            Ok(header) => headers.push(header),
            Err(e) => {
                ic_cdk::println!("Failed to fetch block at height {}: {}", height, e);
                return Err(format!("Failed at height {}: {}", height, e));
            }
        }
        
        // Small delay to avoid rate limiting (in real implementation, batch these)
        // Note: ICP doesn't have sleep, so we'd need to structure this differently
    }
    
    Ok(headers)
}

/// Parse WoC block header JSON
fn parse_woc_header(json: &Value) -> Result<BlockHeader, String> {
    Ok(BlockHeader {
        height: json["height"]
            .as_u64()
            .ok_or("Missing 'height'")?,
        hash: json["hash"]
            .as_str()
            .ok_or("Missing 'hash'")?
            .to_string(),
        previous_hash: json["previousblockhash"]
            .as_str()
            .ok_or("Missing 'previousblockhash'")?
            .to_string(),
        merkle_root: json["merkleroot"]
            .as_str()
            .ok_or("Missing 'merkleroot'")?
            .to_string(),
        timestamp: json["time"]
            .as_u64()
            .ok_or("Missing 'time'")?,
        bits: json["bits"]
            .as_str()
            .and_then(|s| u32::from_str_radix(s, 16).ok())
            .ok_or("Invalid 'bits'")?,
        nonce: json["nonce"]
            .as_u64()
            .ok_or("Missing 'nonce'")? as u32,
        version: json["version"]
            .as_i64()
            .ok_or("Missing 'version'")? as i32,
        raw_header: "".to_string(), // WoC doesn't provide raw header easily
    })
}

/// Parse Bitails block header JSON (now normalized by transform)
fn parse_bitails_header(json: &Value, _height: u64) -> Result<BlockHeader, String> {
    // After transform, fields are normalized to lowercase format
    // Get height from JSON instead of parameter
    Ok(BlockHeader {
        height: json["height"]
            .as_u64()
            .ok_or("Missing 'height'")?,
        hash: json["hash"]
            .as_str()
            .ok_or("Missing 'hash'")?
            .to_string(),
        previous_hash: json["previousblockhash"]
            .as_str()
            .ok_or("Missing 'previousblockhash'")?
            .to_string(),
        merkle_root: json["merkleroot"]
            .as_str()
            .ok_or("Missing 'merkleroot'")?
            .to_string(),
        timestamp: json["time"]
            .as_u64()
            .ok_or("Missing 'time'")?,
        bits: json["bits"]
            .as_str()
            .and_then(|s| u32::from_str_radix(s, 16).ok())
            .ok_or("Invalid 'bits'")?,
        nonce: json["nonce"]
            .as_u64()
            .ok_or("Missing 'nonce'")? as u32,
        version: json["version"]
            .as_i64()
            .ok_or("Missing 'version'")? as i32,
        raw_header: json["header"]
            .as_str()
            .unwrap_or("")
            .to_string(),
    })
}

/// Result of consensus tip finding with fallback mode flag
#[derive(Debug, Clone)]
pub struct ConsensusResult {
    pub tip: BlockInfo,
    pub use_txarchive_fallback: bool, // If true, fetch blocks from TxArchive instead of APIs
}

/// Find consensus tip between WoC and Bitails
/// Once we find a matching block, all previous blocks are guaranteed to match
/// due to cryptographic linking (each hash includes previous block hash)
pub async fn find_consensus_tip() -> Result<ConsensusResult, String> {
    ic_cdk::println!("🔍 Fetching WoC tip...");
    let woc_result = fetch_woc_tip().await;
    
    ic_cdk::println!("🔍 Fetching Bitails tip...");
    let bitails_result = fetch_bitails_tip().await;

    // Check if both APIs failed
    if woc_result.is_err() && bitails_result.is_err() {
        ic_cdk::println!("❌ Both WoC and Bitails failed, using TxArchive fallback...");
        let tip = find_consensus_tip_with_txarchive_fallback(None, None).await?;
        return Ok(ConsensusResult {
            tip,
            use_txarchive_fallback: true,
        });
    }
    
    // If one failed, use TxArchive fallback with the working API
    if woc_result.is_err() {
        ic_cdk::println!("⚠️ WoC failed, using TxArchive fallback mode with Bitails tip");
        let bitails_tip = bitails_result.unwrap();
        let tip = find_consensus_tip_with_txarchive_fallback(None, Some(bitails_tip)).await?;
        return Ok(ConsensusResult {
            tip,
            use_txarchive_fallback: true,
        });
    }
    
    if bitails_result.is_err() {
        ic_cdk::println!("⚠️ Bitails failed, using TxArchive fallback mode with WoC tip");
        let woc_tip = woc_result.unwrap();
        let tip = find_consensus_tip_with_txarchive_fallback(Some(woc_tip), None).await?;
        return Ok(ConsensusResult {
            tip,
            use_txarchive_fallback: true,
        });
    }
    
    // Both APIs returned data - use normal API mode
    let woc_tip = woc_result.unwrap();
    let bitails_tip = bitails_result.unwrap();
    
    ic_cdk::println!(
        "WoC tip: height={}, hash={}",
        woc_tip.height,
        &woc_tip.hash[..8]
    );
    ic_cdk::println!(
        "Bitails tip: height={}, hash={}",
        bitails_tip.height,
        &bitails_tip.hash[..8]
    );

    // If they agree on the tip, perfect! Use it directly
    if woc_tip.height == bitails_tip.height && woc_tip.hash == bitails_tip.hash {
        ic_cdk::println!("✅ Tips match exactly at height {}", woc_tip.height);
        return Ok(ConsensusResult {
            tip: woc_tip,
            use_txarchive_fallback: false,
        });
    }

    // Check last 10 blocks to find where they agree (ignore 1-2 peak differences)
    // Once found, all blocks before are guaranteed valid due to chain linking
    let start_height = std::cmp::min(woc_tip.height, bitails_tip.height);
    
    ic_cdk::println!("Checking last 10 blocks for consensus point...");
    
    for offset in 0..10 {
        if start_height < offset {
            break;
        }
        let check_height = start_height - offset;
        
        // Fetch same height from both - only need hash comparison
        let woc_result = fetch_woc_block_header_by_height(check_height).await;
        let bitails_result = fetch_bitails_block_header(check_height).await;
        
        if let (Ok(woc_block), Ok(bitails_block)) = (woc_result, bitails_result) {
            if woc_block.hash == bitails_block.hash {
                ic_cdk::println!(
                    "✅ Consensus found at height {}: hash={}",
                    check_height,
                    &woc_block.hash[..8]
                );
                ic_cdk::println!("   All blocks below {} are cryptographically guaranteed to match", check_height);
                return Ok(ConsensusResult {
                    tip: BlockInfo {
                        height: check_height,
                        hash: woc_block.hash,
                    },
                    use_txarchive_fallback: false,
                });
            }
        }
    }

    // WoC and Bitails disagree - they will eventually agree, so do nothing
    ic_cdk::println!("⚠️ WoC and Bitails disagree on last 10 blocks - waiting for consensus");
    Err("WoC and Bitails disagree - waiting for them to sync up".to_string())
}

/// Transform function for HTTP responses (required by ICP)
/// CRITICAL: Must produce IDENTICAL output on all replicas for consensus
/// Extracts only immutable blockchain fields in deterministic order
#[ic_cdk::query]
fn transform_http_response(args: TransformArgs) -> HttpResponse {
    let mut response = args.response;
    
    // Log original response for debugging
    if let Ok(body_str) = String::from_utf8(response.body.clone()) {
        ic_cdk::println!("📥 Original API response (first 500 chars): {}", 
            &body_str.chars().take(500).collect::<String>());
    }
    
    // Parse and rebuild response with only essential fields in fixed order
    if let Ok(body_str) = String::from_utf8(response.body.clone()) {
        if let Ok(json) = serde_json::from_str::<Value>(&body_str) {
            
            // Handle array responses (Bitails block list)
            if let Some(array) = json.as_array() {
                let mut block_jsons = Vec::new();
                
                for item in array {
                    if let Some(obj) = item.as_object() {
                        let height = obj.get("height").and_then(|v| v.as_u64()).unwrap_or(0);
                        let hash = obj.get("hash").and_then(|v| v.as_str()).unwrap_or("");
                        let version = obj.get("version").and_then(|v| v.as_i64()).unwrap_or(0);
                        let merkleroot = obj.get("merkleroot")
                            .or(obj.get("merkleRoot"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let time = obj.get("time").and_then(|v| v.as_u64()).unwrap_or(0);
                        let bits = obj.get("bits").and_then(|v| v.as_str()).unwrap_or("");
                        let nonce = obj.get("nonce").and_then(|v| v.as_u64()).unwrap_or(0);
                        let prev_hash = obj.get("previousblockhash")
                            .or(obj.get("previousBlockHash"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let header = obj.get("header")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        
                        // Build deterministic JSON for this block (include header field for SPV verification)
                        let block_json = format!(
                            r#"{{"bits":"{}","hash":"{}","header":"{}","height":{},"merkleroot":"{}","nonce":{},"previousblockhash":"{}","time":{},"version":{}}}"#,
                            bits, hash, header, height, merkleroot, nonce, prev_hash, time, version
                        );
                        block_jsons.push(block_json);
                    }
                }
                
                // Return as array with all blocks
                let deterministic = format!("[{}]", block_jsons.join(","));
                ic_cdk::println!("📤 Transformed block list: {} blocks", block_jsons.len());
                response.body = deterministic.into_bytes();
            }
            // Handle object responses
            else if let Some(obj) = json.as_object() {
                
                // Chain info responses - extract tip height and hash only
                if obj.contains_key("blocks") {
                    // Build deterministic JSON string manually to ensure consistent ordering
                    let blocks = obj.get("blocks")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let hash = obj.get("bestblockhash")
                        .or(obj.get("bestBlockHash"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    
                    // Fixed key order: bestblockhash, blocks
                    let deterministic = format!(r#"{{"bestblockhash":"{}","blocks":{}}}"#, hash, blocks);
                    ic_cdk::println!("📤 Transformed chain info: {}", deterministic);
                    response.body = deterministic.into_bytes();
                }
                // Block header - extract only immutable fields in fixed order
                else if obj.contains_key("hash") && obj.contains_key("height") {
                    let height = obj.get("height").and_then(|v| v.as_u64()).unwrap_or(0);
                    let hash = obj.get("hash").and_then(|v| v.as_str()).unwrap_or("");
                    let version = obj.get("version").and_then(|v| v.as_i64()).unwrap_or(0);
                    let merkleroot = obj.get("merkleroot")
                        .or(obj.get("merkleRoot"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let time = obj.get("time").and_then(|v| v.as_u64()).unwrap_or(0);
                    let bits = obj.get("bits").and_then(|v| v.as_str()).unwrap_or("");
                    let nonce = obj.get("nonce").and_then(|v| v.as_u64()).unwrap_or(0);
                    let prev_hash = obj.get("previousblockhash")
                        .or(obj.get("previousBlockHash"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let header = obj.get("header")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    
                    // Fixed alphabetical key order for deterministic output (include header for SPV verification)
                    let deterministic = format!(
                        r#"{{"bits":"{}","hash":"{}","header":"{}","height":{},"merkleroot":"{}","nonce":{},"previousblockhash":"{}","time":{},"version":{}}}"#,
                        bits, hash, header, height, merkleroot, nonce, prev_hash, time, version
                    );
                    ic_cdk::println!("📤 Transformed block header: {}", deterministic);
                    response.body = deterministic.into_bytes();
                } else {
                    ic_cdk::println!("⚠️ Unknown response format, passing through unchanged");
                }
            } else {
                ic_cdk::println!("⚠️ Response is not a JSON object");
            }
        } else {
            ic_cdk::println!("❌ Failed to parse response as JSON");
        }
    } else {
        ic_cdk::println!("❌ Failed to decode response body as UTF-8");
    }
    
    HttpResponse {
        status: response.status,
        headers: vec![], // Always strip headers - contain timestamps
        body: response.body,
    }
}

// ==================== TxArchive Fallback Logic ====================

#[derive(CandidType, Deserialize, Debug)]
struct TxArchiveBlockInfo {
    success: bool,
    height: Option<u64>,
    hash: Option<String>,
    previous_hash: Option<String>,
    merkle_root: Option<String>,
    timestamp: Option<u64>,
    header: Option<String>,
    reason: Option<String>,
    error_code: Option<String>,
}

/// Fetch a single block from TxArchive by height
async fn fetch_block_from_txarchive(height: u64) -> Result<TxArchiveBlockInfo, String> {
    let txarchive_canister = Principal::from_text("glgze-4qaaa-aaaac-a4m2a-cai")
        .map_err(|e| format!("Invalid TxArchive principal: {}", e))?;
    
    let (response,): (TxArchiveBlockInfo,) = ic_cdk::call(
        txarchive_canister,
        "get_block_info",
        (height,)
    )
    .await
    .map_err(|e| format!("TxArchive call failed: {:?}", e))?;
    
    if !response.success {
        return Err(format!(
            "TxArchive returned failure for height {}: {}",
            height,
            response.reason.unwrap_or_else(|| "Unknown reason".to_string())
        ));
    }
    
    Ok(response)
}

/// Convert TxArchive block info to BlockHeader
fn txarchive_to_block_header(block: TxArchiveBlockInfo) -> Result<BlockHeader, String> {
    Ok(BlockHeader {
        height: block.height.ok_or("Missing height")?,
        hash: block.hash.ok_or("Missing hash")?,
        previous_hash: block.previous_hash.ok_or("Missing previous_hash")?,
        merkle_root: block.merkle_root.ok_or("Missing merkle_root")?,
        timestamp: block.timestamp.ok_or("Missing timestamp")?,
        raw_header: block.header.unwrap_or_default(),
        // TxArchive doesn't store these fields, use defaults
        bits: 0,
        nonce: 0,
        version: 0,
    })
}

/// Fetch blocks from TxArchive with automatic chain validation and reorg handling
/// Returns Vec<BlockHeader> from start_height up to network tip (or until chain break)
pub async fn fetch_blocks_from_txarchive(
    network_tip_height: u64,
    our_local_tip: Option<(u64, String)>, // (height, hash) of our highest block
) -> Result<Vec<BlockHeader>, String> {
    ic_cdk::println!(
        "� Fetching blocks from TxArchive: network_tip={}, local_tip={:?}",
        network_tip_height,
        our_local_tip
    );
    
    let mut fetched_blocks = Vec::new();
    
    // Determine where to start fetching
    let (start_height, expected_prev_hash) = match our_local_tip {
        Some((local_height, local_hash)) => {
            // Start from next block after our tip
            ic_cdk::println!("Starting from local tip + 1: height={}", local_height + 1);
            (local_height + 1, Some(local_hash))
        }
        None => {
            // No local blocks - start from a safe point (288 blocks back from tip)
            let safe_start = if network_tip_height > 288 {
                network_tip_height - 288
            } else {
                0
            };
            ic_cdk::println!("No local blocks - starting from height {}", safe_start);
            (safe_start, None)
        }
    };
    
    // If we have local blocks, validate chain continuity
    if let Some(expected_hash) = expected_prev_hash {
        // Fetch the first block and verify it links to our chain
        ic_cdk::println!("🔗 Validating chain continuity at height {}", start_height);
        
        let first_block = match fetch_block_from_txarchive(start_height).await {
            Ok(block) => block,
            Err(e) => {
                ic_cdk::println!("❌ Failed to fetch first block for continuity check: {}", e);
                return Err(format!("TxArchive doesn't have block {}: {}", start_height, e));
            }
        };
        
        let first_prev_hash = first_block.previous_hash
            .as_ref()
            .ok_or("First block missing previous_hash")?;
        
        if first_prev_hash != &expected_hash {
            // REORG DETECTED - our local tip doesn't match TxArchive
            ic_cdk::println!(
                "🔀 REORG DETECTED! Block {} previous_hash mismatch",
                start_height
            );
            ic_cdk::println!("   Expected: {}", &expected_hash[..8]);
            ic_cdk::println!("   Got:      {}", &first_prev_hash[..8]);
            
            return Err(format!(
                "Chain continuity break at height {}. Reorg detected - caller must handle rollback.",
                start_height
            ));
        }
        
        ic_cdk::println!("✅ Chain continuity validated");
    }
    
    // Fetch blocks from start_height to network_tip_height
    ic_cdk::println!(
        "📥 Fetching blocks from {} to {} ({} blocks)",
        start_height,
        network_tip_height,
        network_tip_height - start_height + 1
    );
    
    for height in start_height..=network_tip_height {
        match fetch_block_from_txarchive(height).await {
            Ok(block_info) => {
                match txarchive_to_block_header(block_info) {
                    Ok(header) => {
                        fetched_blocks.push(header);
                        
                        if fetched_blocks.len() % 50 == 0 {
                            ic_cdk::println!("📦 Fetched {} blocks...", fetched_blocks.len());
                        }
                    }
                    Err(e) => {
                        ic_cdk::println!("⚠️ Failed to convert block {}: {}", height, e);
                        break; // Stop fetching at first conversion error
                    }
                }
            }
            Err(e) => {
                ic_cdk::println!("⚠️ TxArchive doesn't have block {} yet: {}", height, e);
                break; // Stop fetching when we hit unavailable blocks
            }
        }
    }
    
    ic_cdk::println!("✅ Fetched {} blocks from TxArchive", fetched_blocks.len());
    Ok(fetched_blocks)
}

/// Find consensus tip using TxArchive when one or both APIs fail
/// This only finds the TIP - actual block fetching is done separately
async fn find_consensus_tip_with_txarchive_fallback(
    woc_tip: Option<BlockInfo>,
    bitails_tip: Option<BlockInfo>,
) -> Result<BlockInfo, String> {
    // Determine which API is working (if any)
    let working_api_tip = woc_tip.as_ref().or(bitails_tip.as_ref());
    
    if working_api_tip.is_none() {
        ic_cdk::println!("❌ Both APIs failed completely - cannot determine network tip");
        return Err("Both APIs failed - cannot determine network tip for TxArchive sync".to_string());
    }
    
    let api_tip = working_api_tip.unwrap().clone();
    ic_cdk::println!(
        "🔍 TxArchive fallback mode: Network tip from API: height={}, hash={}",
        api_tip.height,
        &api_tip.hash[..8]
    );
    
    // Simply return the API tip - TxArchive will be used as the DATA SOURCE
    // The actual block fetching and validation happens in fetch_blocks_from_txarchive()
    Ok(api_tip)
}
