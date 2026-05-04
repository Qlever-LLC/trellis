use std::path::PathBuf;

const SYSTEM_JOBS_DB_PATH: &str = "/var/lib/trellis/jobs.sqlite";
const USER_JOBS_DB_RELATIVE_PATH: &str = ".var/lib/trellis/jobs.sqlite";
const JOBS_DB_PATH_ENV: &str = "TRELLIS_JOBS_DB_PATH";

pub(crate) fn jobs_db_path_from_env() -> PathBuf {
    std::env::var_os(JOBS_DB_PATH_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(default_jobs_db_path)
}

fn default_jobs_db_path() -> PathBuf {
    default_jobs_db_path_for(
        running_as_root(),
        std::env::var_os("HOME").map(PathBuf::from),
    )
}

fn default_jobs_db_path_for(is_root: bool, home: Option<PathBuf>) -> PathBuf {
    if is_root {
        return PathBuf::from(SYSTEM_JOBS_DB_PATH);
    }

    home.unwrap_or_else(|| PathBuf::from("."))
        .join(USER_JOBS_DB_RELATIVE_PATH)
}

#[cfg(target_os = "linux")]
fn running_as_root() -> bool {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|status| effective_uid_from_proc_status(&status))
        == Some(0)
}

#[cfg(not(target_os = "linux"))]
fn running_as_root() -> bool {
    false
}

#[cfg(target_os = "linux")]
fn effective_uid_from_proc_status(status: &str) -> Option<u32> {
    status.lines().find_map(|line| {
        let uids = line.strip_prefix("Uid:")?;
        uids.split_whitespace().nth(1)?.parse().ok()
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::default_jobs_db_path_for;
    #[cfg(target_os = "linux")]
    use super::effective_uid_from_proc_status;

    #[test]
    fn default_jobs_db_path_uses_system_path_for_root() {
        assert_eq!(
            default_jobs_db_path_for(true, Some(PathBuf::from("/home/alice"))),
            PathBuf::from("/var/lib/trellis/jobs.sqlite")
        );
    }

    #[test]
    fn default_jobs_db_path_uses_home_var_for_non_root() {
        assert_eq!(
            default_jobs_db_path_for(false, Some(PathBuf::from("/home/alice"))),
            PathBuf::from("/home/alice/.var/lib/trellis/jobs.sqlite")
        );
    }

    #[test]
    fn default_jobs_db_path_uses_relative_var_when_home_is_missing() {
        assert_eq!(
            default_jobs_db_path_for(false, None),
            PathBuf::from("./.var/lib/trellis/jobs.sqlite")
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn effective_uid_from_proc_status_parses_effective_uid() {
        let status = "Name:\ttrellis\nUid:\t1000\t1001\t1002\t1003\n";

        assert_eq!(effective_uid_from_proc_status(status), Some(1001));
    }
}
