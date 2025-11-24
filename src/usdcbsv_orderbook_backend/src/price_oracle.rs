use ic_cdk::api::management_canister::http_request::{
    http_request, CanisterHttpRequestArgument, HttpHeader, HttpMethod, HttpResponse, TransformArgs, TransformContext,
};
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use crate::state::*;

#[derive(Serialize, Deserialize, Debug)]
struct CoinloreResponse {
    id: String,
    symbol: String,
    name: String,
    price_usd: String,
    #[serde(default)]
    rank: Option<u32>,
    #[serde(default)]
    market_cap_usd: Option<String>,
}

const BSV_API_URL: &str = "https://api.coinlore.net/api/ticker/?id=33234";
const PRICE_CACHE_DURATION_NS: u64 = 5 * 60 * 1_000_000_000; // 5 minutes in nanoseconds

pub async fn get_bsv_price() -> Result<f64, String> {
    // Check cache first
    let (cached_price, last_update) = get_cached_bsv_price();
    let now = get_time();
    
    if cached_price > 0.0 && (now - last_update) < PRICE_CACHE_DURATION_NS {
        return Ok(cached_price);
    }
    
    // Try XRC oracle first (decentralized)
    match crate::xrc_oracle::get_bsv_usd_rate().await {
        Ok(price) => {
            // Update cache
            crate::state::update_cached_bsv_price(price);
            return Ok(price);
        }
        Err(e) => {
            ic_cdk::println!("XRC oracle failed, falling back to HTTP: {}", e);
            // Fall back to HTTP API
            fetch_bsv_price_from_api().await
        }
    }
}

async fn fetch_bsv_price_from_api() -> Result<f64, String> {
    let request_headers = vec![
        HttpHeader {
            name: "User-Agent".to_string(),
            value: "easyswap_canister".to_string(),
        },
        HttpHeader {
            name: "Accept".to_string(),
            value: "application/json".to_string(),
        },
    ];

    let request = CanisterHttpRequestArgument {
        url: BSV_API_URL.to_string(),
        method: HttpMethod::GET,
        body: None,
        max_response_bytes: Some(2048),
        transform: Some(ic_cdk::api::management_canister::http_request::TransformContext {
            function: ic_cdk::api::management_canister::http_request::TransformFunc(
                candid::Func {
                    principal: ic_cdk::api::id(),
                    method: "transform_price_response".to_string(),
                }
            ),
            context: vec![],
        }),
        headers: request_headers,
    };

    match http_request(request, 25_000_000_000).await {
        Ok((response,)) => {
            let body_str = String::from_utf8(response.body)
                .map_err(|e| format!("Failed to parse response as UTF-8: {}", e))?;
            
            // Parse JSON array response
            let prices: Vec<CoinloreResponse> = serde_json::from_str(&body_str)
                .map_err(|e| format!("Failed to parse JSON: {} - Body: {}", e, body_str))?;
            
            if prices.is_empty() {
                return Err("No price data returned from API".to_string());
            }
            
            let price_str = &prices[0].price_usd;
            let price = price_str.parse::<f64>()
                .map_err(|e| format!("Failed to parse price: {}", e))?;
            
            // Update cache
            update_cached_bsv_price(price);
            
            Ok(price)
        }
        Err((r, m)) => {
            Err(format!("HTTP request failed. RejectionCode: {:?}, Error: {}", r, m))
        }
    }
}

#[ic_cdk::query]
fn transform_price_response(args: TransformArgs) -> HttpResponse {
    HttpResponse {
        status: args.response.status.clone(),
        body: args.response.body.clone(),
        headers: vec![
            HttpHeader {
                name: "Content-Security-Policy".to_string(),
                value: "default-src 'self'".to_string(),
            },
            HttpHeader {
                name: "Content-Type".to_string(),
                value: "application/json".to_string(),
            },
        ],
    }
}

// Helper function to calculate satoshis from USD amount
pub fn usd_to_satoshis(usd_amount: f64, bsv_price_usd: f64) -> u64 {
    if bsv_price_usd <= 0.0 {
        return 0;
    }
    
    // usd_amount is already in dollars (e.g., 1.50 = $1.50)
    let bsv_amount = usd_amount / bsv_price_usd;
    let satoshis = (bsv_amount * 100_000_000.0).round() as u64;
    
    satoshis
}

// Helper function to check if current price exceeds max price
pub fn price_exceeds_max(max_bsv_price: f64) -> Result<bool, String> {
    let (cached_price, last_update) = get_cached_bsv_price();
    let now = get_time();
    
    // If price is stale, don't make trading decisions
    if cached_price <= 0.0 || (now - last_update) > PRICE_CACHE_DURATION_NS {
        return Err("BSV price data is stale or unavailable".to_string());
    }
    
    Ok(cached_price > max_bsv_price)
}
