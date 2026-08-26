#![cfg(test)]

use crate::tests::utils::setup_vault;
use crate::BatchDepositItem;
use soroban_sdk::Vec;

#[test]
fn test_batch_deposit_multiple_users() {
    let (env, client, _owner, agent, user1, user2, _token_admin) = setup_vault();

    // Mint USDC to agent so agent can perform batch deposit
    let usdc_client = soroban_sdk::token::StellarAssetClient::new(&env, &client.get_usdc_token());
    usdc_client.mint(&agent, &1000_0000000);

    let mut deposits = Vec::new(&env);
    deposits.push_back(BatchDepositItem {
        user: user1.clone(),
        amount: 100_0000000,
    });
    deposits.push_back(BatchDepositItem {
        user: user2.clone(),
        amount: 200_0000000,
    });

    client.batch_deposit(&agent, &deposits);

    assert_eq!(client.get_user_shares(&user1), 100_0000000);
    assert_eq!(client.get_user_shares(&user2), 200_0000000);
}
