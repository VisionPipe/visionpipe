use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditLedger {
    pub balance: u64,
}

pub struct CaptureJob {
    pub width: u32,
    pub height: u32,
    pub has_annotation: bool,
    pub has_voice: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditCost {
    pub capture: u64,
    pub annotation: u64,
    pub voice: u64,
    pub total: u64,
}

pub fn calculate_cost(job: &CaptureJob) -> CreditCost {
    let pixels = job.width as u64 * job.height as u64;
    let block_size: u64 = 1_000_000;
    let capture = pixels.div_ceil(block_size);

    let annotation = if job.has_annotation { 1 } else { 0 };
    let voice = if job.has_voice { 1 } else { 0 };
    let total = capture + annotation + voice;

    CreditCost { capture, annotation, voice, total }
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

    pub fn deduct(&mut self, cost: &CreditCost) -> Result<u64, InsufficientCredits> {
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

    #[test]
    fn test_1080p_capture_cost() {
        let job = CaptureJob { width: 1920, height: 1080, has_annotation: false, has_voice: false };
        let cost = calculate_cost(&job);
        assert_eq!(cost.capture, 3);
        assert_eq!(cost.total, 3);
    }

    #[test]
    fn test_small_region_capture_cost() {
        let job = CaptureJob { width: 400, height: 300, has_annotation: false, has_voice: false };
        let cost = calculate_cost(&job);
        assert_eq!(cost.capture, 1);
        assert_eq!(cost.total, 1);
    }

    #[test]
    fn test_4k_capture_cost() {
        let job = CaptureJob { width: 3840, height: 2160, has_annotation: false, has_voice: false };
        let cost = calculate_cost(&job);
        assert_eq!(cost.capture, 9);
        assert_eq!(cost.total, 9);
    }

    #[test]
    fn test_1440p_capture_cost() {
        let job = CaptureJob { width: 2560, height: 1440, has_annotation: false, has_voice: false };
        let cost = calculate_cost(&job);
        assert_eq!(cost.capture, 4);
        assert_eq!(cost.total, 4);
    }

    #[test]
    fn test_annotation_surcharge() {
        let job = CaptureJob { width: 1920, height: 1080, has_annotation: true, has_voice: false };
        let cost = calculate_cost(&job);
        assert_eq!(cost.annotation, 1);
        assert_eq!(cost.voice, 0);
        assert_eq!(cost.total, 4);
    }

    #[test]
    fn test_voice_surcharge() {
        let job = CaptureJob { width: 1920, height: 1080, has_annotation: false, has_voice: true };
        let cost = calculate_cost(&job);
        assert_eq!(cost.annotation, 0);
        assert_eq!(cost.voice, 1);
        assert_eq!(cost.total, 4);
    }

    #[test]
    fn test_both_surcharges() {
        let job = CaptureJob { width: 1920, height: 1080, has_annotation: true, has_voice: true };
        let cost = calculate_cost(&job);
        assert_eq!(cost.annotation, 1);
        assert_eq!(cost.voice, 1);
        assert_eq!(cost.total, 5);
    }

    #[test]
    fn test_deduction_success() {
        let mut ledger = CreditLedger::new(10);
        let cost = CreditCost { capture: 3, annotation: 1, voice: 0, total: 4 };
        let result = ledger.deduct(&cost);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 6);
        assert_eq!(ledger.balance, 6);
    }

    #[test]
    fn test_deduction_insufficient() {
        let mut ledger = CreditLedger::new(2);
        let cost = CreditCost { capture: 3, annotation: 1, voice: 0, total: 4 };
        let result = ledger.deduct(&cost);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.required, 4);
        assert_eq!(err.available, 2);
        assert_eq!(ledger.balance, 2);
    }

    #[test]
    fn test_deduction_exact_balance() {
        let mut ledger = CreditLedger::new(5);
        let cost = CreditCost { capture: 3, annotation: 1, voice: 1, total: 5 };
        let result = ledger.deduct(&cost);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0);
        assert_eq!(ledger.balance, 0);
    }
}
