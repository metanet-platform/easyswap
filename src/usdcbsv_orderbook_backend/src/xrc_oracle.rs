use candid::{CandidType, Deserialize, Nat, Principal};
use ic_cdk::api::call::CallResult;
use serde::Serialize;

// XRC Canister ID on mainnet
const XRC_CANISTER_ID: &str = "uf6dk-hyaaa-aaaaq-qaaaq-cai";

// Cycles to send with XRC calls (1B cycles, unused will be returned)
const XRC_CALL_CYCLES: u64 = 1_000_000_000;

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct Asset {
    pub symbol: String,
    pub class: AssetClass,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum AssetClass {
    Cryptocurrency,
    FiatCurrency,
}

#[derive(CandidType, Deserialize)]
pub struct GetExchangeRateRequest {
    pub base_asset: Asset,
    pub quote_asset: Asset,
    pub timestamp: Option<u64>,
}

#[derive(CandidType, Deserialize, Debug)]
pub struct ExchangeRateMetadata {
    pub decimals: u32,
    pub base_asset_num_queried_sources: usize,
    pub base_asset_num_received_rates: usize,
    pub quote_asset_num_queried_sources: usize,
    pub quote_asset_num_received_rates: usize,
    pub standard_deviation: u64,
    pub forex_timestamp: Option<u64>,
}

#[derive(CandidType, Deserialize, Debug)]
pub struct ExchangeRate {
    pub base_asset: Asset,
    pub quote_asset: Asset,
    pub timestamp: u64,
    pub rate: u64,
    pub metadata: ExchangeRateMetadata,
}

#[derive(CandidType, Deserialize, Debug)]
pub enum ExchangeRateError {
    AnonymousPrincipalNotAllowed,
    CryptoQuoteAssetNotFound,
    FailedToAcceptCycles,
    ForexBaseAssetNotFound,
    ForexAssetsNotFound,
    ForexInvalidTimestamp,
    ForexQuoteAssetNotFound,
    InconsistentRatesReceived,
    NotEnoughCycles,
    Other { code: u32, description: String },
    Pending,
    RateLimited,
    StablecoinRateNotFound,
    StablecoinRateTooFewRates,
    StablecoinRateZeroRate,
}

/// Get BSV/USD exchange rate from XRC
pub async fn get_bsv_usd_rate() -> Result<f64, String> {
    let xrc = Principal::from_text(XRC_CANISTER_ID)
        .map_err(|e| format!("Invalid XRC principal: {}", e))?;

    let request = GetExchangeRateRequest {
        base_asset: Asset {
            symbol: "BSV".to_string(),
            class: AssetClass::Cryptocurrency,
        },
        quote_asset: Asset {
            symbol: "USD".to_string(),
            class: AssetClass::FiatCurrency,
        },
        timestamp: None,
    };

    let result: CallResult<(Result<ExchangeRate, ExchangeRateError>,)> = 
        ic_cdk::api::call::call_with_payment(
            xrc,
            "get_exchange_rate",
            (request,),
            XRC_CALL_CYCLES,
        ).await;

    match result {
        Ok((Ok(rate),)) => {
            // XRC returns rate with decimals (typically 9)
            // rate = 4500000000 means $45.00 with 9 decimals
            let decimals = rate.metadata.decimals;
            let rate_value = rate.rate as f64 / 10f64.powi(decimals as i32);
            
            ic_cdk::println!("BSV/USD rate from XRC: ${} (sources: {})", 
                rate_value, 
                rate.metadata.base_asset_num_received_rates
            );
            
            Ok(rate_value)
        }
        Ok((Err(error),)) => Err(format!("XRC error: {:?}", error)),
        Err((code, msg)) => Err(format!("Call failed: {:?}: {}", code, msg)),
    }
}

/// Get ETH/USD exchange rate from XRC (with 5-minute cache)
pub async fn get_eth_usd_rate() -> Result<f64, String> {
    // Check cache first (5 minutes = 300 seconds = 300_000_000_000 ns)
    let (cached_price, last_update) = crate::state::get_cached_eth_usd_price();
    let now = crate::state::get_time();
    const CACHE_DURATION_NS: u64 = 5 * 60 * 1_000_000_000; // 5 minutes
    
    if cached_price > 0.0 && (now - last_update) < CACHE_DURATION_NS {
        ic_cdk::println!("Using cached ETH/USD price: ${} (age: {}s)", 
            cached_price, 
            (now - last_update) / 1_000_000_000
        );
        return Ok(cached_price);
    }
    
    // Fetch fresh price from XRC
    let xrc = Principal::from_text(XRC_CANISTER_ID)
        .map_err(|e| format!("Invalid XRC principal: {}", e))?;

    let request = GetExchangeRateRequest {
        base_asset: Asset {
            symbol: "ETH".to_string(),
            class: AssetClass::Cryptocurrency,
        },
        quote_asset: Asset {
            symbol: "USD".to_string(),
            class: AssetClass::FiatCurrency,
        },
        timestamp: None,
    };

    let result: CallResult<(Result<ExchangeRate, ExchangeRateError>,)> = 
        ic_cdk::api::call::call_with_payment(
            xrc,
            "get_exchange_rate",
            (request,),
            XRC_CALL_CYCLES,
        ).await;

    match result {
        Ok((Ok(rate),)) => {
            let decimals = rate.metadata.decimals;
            let rate_value = rate.rate as f64 / 10f64.powi(decimals as i32);
            
            ic_cdk::println!("ETH/USD rate from XRC: ${} (sources: {})", 
                rate_value, 
                rate.metadata.base_asset_num_received_rates
            );
            
            // Update cache
            crate::state::update_cached_eth_usd_price(rate_value);
            
            Ok(rate_value)
        }
        Ok((Err(error),)) => Err(format!("XRC error: {:?}", error)),
        Err((code, msg)) => Err(format!("Call failed: {:?}: {}", code, msg)),
    }
}
