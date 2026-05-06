use serde::{Deserialize, Serialize};

/// Persisted credit ledger. Wrapped in a `Mutex<CreditLedger>` Tauri-managed
/// state in `lib.rs`; persisted to `visionpipe.json` (key: `credit_balance`)
/// via `tauri-plugin-store`. 1 credit = $0.01.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditLedger {
    pub balance: u64,
}

/// Per-bundle (per Copy & Send) cost breakdown. Returned by both
/// `preview_bundle_cost` (no-op preview, called frequently) and
/// `deduct_for_bundle` (consumes balance, called once on send).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BundleCost {
    /// 1 credit per screenshot in the bundle at send time.
    pub screenshots: u64,
    /// 1 credit per annotation. Currently always 0 — annotation feature
    /// was removed in commit da1c132 (multi-screenshot rewrite). The field
    /// stays so re-introducing annotation is a one-line caller change.
    pub annotations: u64,
    /// ceil(max(0, audio_seconds - 10) / 10). First 10s free.
    pub audio: u64,
    /// Sum of the three above. Provided so the frontend doesn't recompute.
    pub total: u64,
}

/// Pure cost calculation. No state, no IO.
pub fn calculate_bundle_cost(
    screenshot_count: u64,
    annotation_count: u64,
    audio_seconds: u64,
) -> BundleCost {
    let screenshots = screenshot_count;
    let annotations = annotation_count;
    let audio = if audio_seconds <= 10 {
        0
    } else {
        (audio_seconds - 10).div_ceil(10)
    };
    let total = screenshots + annotations + audio;
    BundleCost { screenshots, annotations, audio, total }
}

#[derive(Debug)]
pub struct InsufficientCredits {
    pub required: u64,
    pub available: u64,
}

impl std::fmt::Display for InsufficientCredits {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Insufficient credits: need {}, have {}", self.required, self.available)
    }
}

impl CreditLedger {
    pub fn new(balance: u64) -> Self {
        Self { balance }
    }

    pub fn deduct(&mut self, cost: &BundleCost) -> Result<u64, InsufficientCredits> {
        if self.balance < cost.total {
            return Err(InsufficientCredits {
                required: cost.total,
                available: self.balance,
            });
        }
        self.balance -= cost.total;
        Ok(self.balance)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── audio tier (10s free, then ceil(extra/10)) ──────────────────────

    #[test]
    fn audio_zero_seconds_is_free() {
        let c = calculate_bundle_cost(0, 0, 0);
        assert_eq!(c.audio, 0);
        assert_eq!(c.total, 0);
    }

    #[test]
    fn audio_under_ten_seconds_is_free() {
        assert_eq!(calculate_bundle_cost(0, 0, 1).audio, 0);
        assert_eq!(calculate_bundle_cost(0, 0, 9).audio, 0);
        assert_eq!(calculate_bundle_cost(0, 0, 10).audio, 0);
    }

    #[test]
    fn audio_eleven_seconds_is_one_credit() {
        assert_eq!(calculate_bundle_cost(0, 0, 11).audio, 1);
    }

    #[test]
    fn audio_twenty_seconds_is_one_credit() {
        // 10s free, 10s extra → ceil(10/10) = 1
        assert_eq!(calculate_bundle_cost(0, 0, 20).audio, 1);
    }

    #[test]
    fn audio_twentyone_seconds_is_two_credits() {
        // 10s free, 11s extra → ceil(11/10) = 2
        assert_eq!(calculate_bundle_cost(0, 0, 21).audio, 2);
    }

    #[test]
    fn audio_fortyseven_seconds_is_four_credits() {
        // 10s free, 37s extra → ceil(37/10) = 4
        assert_eq!(calculate_bundle_cost(0, 0, 47).audio, 4);
    }

    #[test]
    fn audio_two_minutes_is_eleven_credits() {
        // 120s total, 110s extra → ceil(110/10) = 11
        assert_eq!(calculate_bundle_cost(0, 0, 120).audio, 11);
    }

    // ── screenshots (1 each, no surcharge) ──────────────────────────────

    #[test]
    fn one_screenshot_no_audio_is_one_credit() {
        let c = calculate_bundle_cost(1, 0, 0);
        assert_eq!(c.screenshots, 1);
        assert_eq!(c.total, 1);
    }

    #[test]
    fn five_screenshots_no_audio_is_five_credits() {
        let c = calculate_bundle_cost(5, 0, 0);
        assert_eq!(c.screenshots, 5);
        assert_eq!(c.total, 5);
    }

    // ── annotations (dormant — proves field still calculates) ──────────

    #[test]
    fn three_annotations_alone_is_three_credits() {
        // Annotation feature is removed today, but the field must still
        // calculate correctly so re-enabling is a one-line caller change.
        let c = calculate_bundle_cost(0, 3, 0);
        assert_eq!(c.annotations, 3);
        assert_eq!(c.total, 3);
    }

    // ── bundle composition (worked examples from the spec) ──────────────

    #[test]
    fn five_screenshots_fortyseven_seconds_is_nine_credits() {
        let c = calculate_bundle_cost(5, 0, 47);
        assert_eq!(c.screenshots, 5);
        assert_eq!(c.audio, 4);
        assert_eq!(c.total, 9);
    }

    #[test]
    fn three_screenshots_five_seconds_is_three_credits() {
        let c = calculate_bundle_cost(3, 0, 5);
        assert_eq!(c.screenshots, 3);
        assert_eq!(c.audio, 0);
        assert_eq!(c.total, 3);
    }

    #[test]
    fn one_screenshot_two_minutes_is_twelve_credits() {
        let c = calculate_bundle_cost(1, 0, 120);
        assert_eq!(c.total, 12);
    }

    // ── deduction ───────────────────────────────────────────────────────

    #[test]
    fn deduct_success_decreases_balance() {
        let mut ledger = CreditLedger::new(10);
        let cost = calculate_bundle_cost(5, 0, 47); // 9 credits
        let result = ledger.deduct(&cost);
        assert_eq!(result.unwrap(), 1);
        assert_eq!(ledger.balance, 1);
    }

    #[test]
    fn deduct_insufficient_returns_err_and_preserves_balance() {
        let mut ledger = CreditLedger::new(2);
        let cost = calculate_bundle_cost(5, 0, 0); // 5 credits
        let err = ledger.deduct(&cost).unwrap_err();
        assert_eq!(err.required, 5);
        assert_eq!(err.available, 2);
        assert_eq!(ledger.balance, 2);
    }

    #[test]
    fn deduct_exact_balance_succeeds_and_zeroes() {
        let mut ledger = CreditLedger::new(9);
        let cost = calculate_bundle_cost(5, 0, 47); // 9 credits
        let result = ledger.deduct(&cost);
        assert_eq!(result.unwrap(), 0);
        assert_eq!(ledger.balance, 0);
    }
}
