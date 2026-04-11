pub fn job_key(service: &str, job_type: &str, job_id: &str) -> String {
    format!("{service}.{job_type}.{job_id}")
}

pub fn worker_presence_key(service: &str, job_type: &str, instance_id: &str) -> String {
    format!("{service}.{job_type}.{instance_id}")
}
