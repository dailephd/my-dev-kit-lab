use rust_reuse::primary::calibrate_sensor;

#[test]
fn ordinary_test() { let _label = "test.skip("; assert_eq!(calibrate_sensor(), 42); }
