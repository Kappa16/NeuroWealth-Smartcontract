#![cfg(test)]

use crate::tests::utils::setup_vault;
use soroban_sdk::testutils::Ledger;

#[test]
fn test_user_deposit_timestamp_and_realized_apy() {
    let (env, client, _owner, _agent, user, _, _) = setup_vault();

    // Zero shares returns 0 timestamp and 0 APY
    assert_eq!(client.get_user_deposit_timestamp(&user), 0);
    assert_eq!(client.get_user_realized_apy(&user), 0);

    let start_time = 1_000_000u64;
    env.ledger().with_mut(|l| l.timestamp = start_time);

    client.deposit(&user, &1000_0000000);
    assert_eq!(client.get_user_deposit_timestamp(&user), start_time);

    // Immediately after deposit, APY is 0 (days_held == 0 or gain == 0)
    assert_eq!(client.get_user_realized_apy(&user), 0);
}
