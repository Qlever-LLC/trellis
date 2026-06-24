use super::cases::{rust_case_by_id, rust_service_case_by_id};
use super::matrix::{load_client_test_matrix, load_service_test_matrix};

pub(crate) fn assert_case_registered(case_id: &str, fixture: &str, module: &str) {
    let matrix = load_client_test_matrix().expect("load shared client integration matrix");
    let matrix_case = matrix
        .case_by_id(case_id)
        .unwrap_or_else(|| panic!("matrix is missing {case_id}"));
    let local_case =
        rust_case_by_id(case_id).unwrap_or_else(|| panic!("Rust manifest is missing {case_id}"));

    assert_eq!(matrix_case.fixture, fixture);
    assert_eq!(local_case.module, module);
}

pub(crate) fn assert_service_case_registered(case_id: &str, fixture: &str, module: &str) {
    let matrix = load_service_test_matrix().expect("load shared service integration matrix");
    let matrix_case = matrix
        .case_by_id(case_id)
        .unwrap_or_else(|| panic!("service matrix is missing {case_id}"));
    let local_case = rust_service_case_by_id(case_id)
        .unwrap_or_else(|| panic!("Rust service manifest is missing {case_id}"));

    assert_eq!(matrix_case.fixture, fixture);
    assert_eq!(local_case.module, module);
}
