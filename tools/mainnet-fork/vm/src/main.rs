//! Offline account-state fork: deployed mainnet ELF and finalized accounts.
//! No RPC client, network writes, production signer files, or private keys.
//! Signature checking is disabled ONLY inside LiteSVM, so public keys can act
//! as test signers. Program-level Squads membership/threshold checks remain on.
use {
    base64::{engine::general_purpose::STANDARD as B64, Engine},
    litesvm::LiteSVM,
    serde_json::{json, Value},
    solana_account::Account,
    solana_address::Address,
    solana_clock::Clock,
    solana_instruction::{AccountMeta, Instruction},
    solana_message::Message,
    solana_signature::Signature,
    solana_transaction::Transaction,
    std::{path::Path, str::FromStr},
};
fn key(s: &str) -> Address {
    Address::from_str(s).unwrap()
}
fn load(path: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}
fn b64(s: &str) -> Vec<u8> {
    B64.decode(s).unwrap()
}
fn instruction(v: &Value) -> Instruction {
    Instruction {
        program_id: key(v["program"].as_str().unwrap()),
        data: b64(v["data"].as_str().unwrap()),
        accounts: v["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| AccountMeta {
                pubkey: key(a["address"].as_str().unwrap()),
                is_signer: a["signer"].as_bool().unwrap(),
                is_writable: a["writable"].as_bool().unwrap(),
            })
            .collect(),
    }
}
fn at(svm: &mut LiteSVM, unix: i64) {
    let mut c: Clock = svm.get_sysvar();
    c.unix_timestamp = unix;
    svm.set_sysvar(&c);
}
fn run(
    svm: &mut LiteSVM,
    payer: Address,
    instructions: &[Instruction],
    nonce: &mut u64,
    label: &str,
    succeeds: bool,
    rows: &mut Vec<Value>,
) {
    *nonce += 1;
    let message = Message::new_with_blockhash(instructions, Some(&payer), &svm.latest_blockhash());
    let mut fake = [0u8; 64];
    fake[..8].copy_from_slice(&nonce.to_le_bytes());
    let tx = Transaction {
        signatures: vec![Signature::from(fake); message.header.num_required_signatures as usize],
        message,
    };
    let result = svm.send_transaction(tx);
    let (ok, err, logs, cu) = match result {
        Ok(m) => (true, None, m.logs, m.compute_units_consumed),
        Err(e) => (
            false,
            Some(format!("{:?}", e.err)),
            e.meta.logs,
            e.meta.compute_units_consumed,
        ),
    };
    rows.push(json!({"check":label,"passed":ok==succeeds,"transactionSucceeded":ok,"error":err,"logs":logs,"computeUnits":cu,"clockUnix":svm.get_sysvar::<Clock>().unix_timestamp}));
    assert_eq!(ok, succeeds, "{}: {:?}\n{:?}", label, err, rows.last());
}
fn config(svm: &LiteSVM, c: Address) -> String {
    B64.encode(svm.get_account(&c).unwrap().data)
}
fn main() {
    let root = std::env::args().nth(1).expect("Pass snapshot directory");
    let root = Path::new(&root);
    let snapshot = load(&root.join("snapshot.json"));
    let prepared = load(&root.join("instructions.json"));
    let config_key = key(snapshot["inst"]["config"].as_str().unwrap());
    let payer = key(prepared["payer"].as_str().unwrap());
    let target = snapshot["config"]["pending"]["effective_at"]
        .as_str()
        .unwrap()
        .parse::<i64>()
        .unwrap();
    let mut svm = LiteSVM::new().with_sigverify(false);
    // Populate the program cache with the exact deployed bytecode, then restore
    // the complete cloned loader/account metadata from the same snapshot.
    for p in snapshot["programs"].as_array().unwrap() {
        svm.add_program(
            key(p["address"].as_str().unwrap()),
            &std::fs::read(root.join(p["elfFile"].as_str().unwrap())).unwrap(),
        )
        .unwrap();
    }
    for (address, a) in snapshot["accounts"].as_object().unwrap() {
        if a.is_null() {
            continue;
        }
        if a["executable"].as_bool() == Some(true)
            && !snapshot["programs"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p["address"].as_str() == Some(address))
        {
            continue;
        }
        svm.set_account(
            key(address),
            Account {
                lamports: a["lamports"].as_u64().unwrap(),
                data: b64(a["data"][0].as_str().unwrap()),
                owner: key(a["owner"].as_str().unwrap()),
                executable: a["executable"].as_bool().unwrap(),
                rent_epoch: a["rentEpoch"].as_u64().unwrap_or(u64::MAX),
            },
        )
        .unwrap();
    }
    let clock_raw = b64(
        snapshot["accounts"]["SysvarC1ock11111111111111111111111111111111"]["data"][0]
            .as_str()
            .unwrap(),
    );
    let clock = Clock {
        slot: u64::from_le_bytes(clock_raw[0..8].try_into().unwrap()),
        epoch_start_timestamp: i64::from_le_bytes(clock_raw[8..16].try_into().unwrap()),
        epoch: u64::from_le_bytes(clock_raw[16..24].try_into().unwrap()),
        leader_schedule_epoch: u64::from_le_bytes(clock_raw[24..32].try_into().unwrap()),
        unix_timestamp: i64::from_le_bytes(clock_raw[32..40].try_into().unwrap()),
    };
    svm.set_sysvar(&clock);
    let initial = svm.clone();
    let ix = |name: &str| instruction(&prepared["instructions"][name]);
    let mut nonce = 0;
    let mut checks = vec![];
    let original_config = config(&svm, config_key);
    at(&mut svm, target - 1);
    run(
        &mut svm,
        payer,
        &[ix("directApplyAdmin")],
        &mut nonce,
        "Admin apply one second before 72 hours is rejected",
        false,
        &mut checks,
    );
    assert_eq!(config(&svm, config_key), original_config);
    at(&mut svm, target);
    run(
        &mut svm,
        payer,
        &[ix("directApplyOutsider")],
        &mut nonce,
        "Ordinary caller cannot apply during admin-only window",
        false,
        &mut checks,
    );
    assert_eq!(config(&svm, config_key), original_config);
    // Build a new apply proposal on the cloned real 2-of-2 multisig.
    svm = initial.clone();
    run(
        &mut svm,
        payer,
        &[ix("create"), ix("proposalCreate")],
        &mut nonce,
        "Create public apply transaction and proposal on the fork",
        true,
        &mut checks,
    );
    run(
        &mut svm,
        payer,
        &[ix("approveRoy")],
        &mut nonce,
        "First admin approves the fork apply proposal",
        true,
        &mut checks,
    );
    at(&mut svm, target);
    run(
        &mut svm,
        payer,
        &[ix("executeRoy")],
        &mut nonce,
        "One approval cannot execute the 2-of-2 apply proposal",
        false,
        &mut checks,
    );
    run(
        &mut svm,
        payer,
        &[ix("approveBrett")],
        &mut nonce,
        "Second admin approves the fork apply proposal",
        true,
        &mut checks,
    );
    run(
        &mut svm,
        payer,
        &[ix("executeRoy")],
        &mut nonce,
        "Two approvals execute apply through the actual Squads vault",
        true,
        &mut checks,
    );
    let applied = config(&svm, config_key);
    run(
        &mut svm,
        payer,
        &[ix("executeRoy")],
        &mut nonce,
        "An executed Squads apply transaction cannot be replayed",
        false,
        &mut checks,
    );
    run(
        &mut svm,
        payer,
        &[ix("cancelRoy")],
        &mut nonce,
        "Backstop cannot undo an already applied public transition",
        false,
        &mut checks,
    );
    run(
        &mut svm,
        payer,
        &[ix("proposeFounderAgain")],
        &mut nonce,
        "Public lock rejects a proposal to restore founder thresholds",
        false,
        &mut checks,
    );
    // Recount the actual two founder wallets after fresh, spaced attestations.
    for n in 0..3 {
        at(&mut svm, target + n * 1800);
        run(
            &mut svm,
            payer,
            &[ix("refresh")],
            &mut nonce,
            "Fresh refresher attestation under public rules",
            true,
            &mut checks,
        );
    }
    let prior_count_start = snapshot["config"]["count"]["started_at"]
        .as_str()
        .unwrap()
        .parse::<i64>()
        .unwrap();
    at(&mut svm, (target + 3600).max(prior_count_start + 86400));
    run(
        &mut svm,
        payer,
        &[ix("beginCount"), ix("count"), ix("finishCount")],
        &mut nonce,
        "Recount the two existing founders under public rules",
        true,
        &mut checks,
    );
    let counted = config(&svm, config_key);
    for (address, a) in prepared["localRegistrationFixtures"]["accounts"]
        .as_object()
        .unwrap()
    {
        svm.set_account(
            key(address),
            Account {
                lamports: a["lamports"].as_u64().unwrap(),
                data: b64(a["data"][0].as_str().unwrap()),
                owner: key(a["owner"].as_str().unwrap()),
                executable: a["executable"].as_bool().unwrap(),
                rent_epoch: 0,
            },
        )
        .unwrap();
    }
    run(
        &mut svm,
        payer,
        &[ix("registerSmall")],
        &mut nonce,
        "A new holder below the 10 bps minimum cannot register",
        false,
        &mut checks,
    );
    let funds_after_apply=snapshot["walletAccounts"].as_array().unwrap().iter().map(|a|{let p=a["dividend_account"].as_str().unwrap();json!({"address":p,"dataAfter":svm.get_account(&key(p)).map(|a|B64.encode(a.data)),"dataBefore":snapshot["accounts"][p]["data"][0]})}).collect::<Vec<_>>();
    let mut cancelled = vec![];
    for name in ["cancelRoy", "cancelBrett"] {
        svm = initial.clone();
        at(&mut svm, target - 60);
        run(
            &mut svm,
            payer,
            &[ix(name)],
            &mut nonce,
            &format!(
                "{} independently executes the approved cancellation backstop",
                name
            ),
            true,
            &mut checks,
        );
        cancelled.push(json!({"member":name,"configAfter":config(&svm,config_key)}));
        at(&mut svm, target);
        run(
            &mut svm,
            payer,
            &[ix("directApplyAdmin")],
            &mut nonce,
            "Cancelled parameters cannot subsequently be applied",
            false,
            &mut checks,
        );
    }
    svm = initial.clone();
    at(&mut svm, target + 86400 - 1);
    run(
        &mut svm,
        payer,
        &[ix("directApplyOutsider")],
        &mut nonce,
        "Ordinary caller remains blocked one second before 96 hours",
        false,
        &mut checks,
    );
    at(&mut svm, target + 86400);
    run(
        &mut svm,
        payer,
        &[ix("directApplyOutsider")],
        &mut nonce,
        "Ordinary caller may apply exactly at 96 hours",
        true,
        &mut checks,
    );
    let permissionless = config(&svm, config_key);
    svm = initial.clone();
    at(&mut svm, target + 7 * 86400 + 1);
    run(
        &mut svm,
        payer,
        &[ix("directApplyAdmin")],
        &mut nonce,
        "Expired pending parameters cannot be applied",
        false,
        &mut checks,
    );
    let report = json!({"environment":"Offline LiteSVM account-state fork of finalized mainnet data","networkWrites":false,"productionKeysRead":false,"signatureVerification":"disabled inside local VM only; no cryptographic custody test","sourceSlot":snapshot["slot"],"programs":snapshot["programs"],"effectiveAt":target,"checks":checks,"appliedConfig":applied,"countedPublicConfig":counted,"permissionlessAppliedConfig":permissionless,"cancelledConfigs":cancelled,"pumpAccounts":funds_after_apply,"localRegistrationFixtures":prepared["localRegistrationFixtures"]["purpose"]});
    std::fs::write(
        root.join("vm-results.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    println!(
        "{}",
        json!({"passed":report["checks"].as_array().unwrap().len(),"failed":0,"networkWrites":false,"programsFromMainnet":2})
    );
}
