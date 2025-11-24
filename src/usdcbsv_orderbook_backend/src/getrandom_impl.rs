// Custom getrandom implementation for IC wasm environment
use getrandom::Error;

#[no_mangle]
unsafe extern "C" fn custom_getrandom(dest: *mut u8, len: usize) -> i32 {
    // Use IC's random bytes
    let random_bytes = ic_cdk::api::management_canister::main::raw_rand()
        .await
        .expect("Failed to get random bytes");
    
    let copy_len = len.min(random_bytes.len());
    std::ptr::copy_nonoverlapping(
        random_bytes.as_ptr(),
        dest,
        copy_len,
    );
    
    0 // Success
}

getrandom::register_custom_getrandom!(custom_getrandom);
