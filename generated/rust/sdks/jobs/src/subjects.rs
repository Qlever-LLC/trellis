//! Raw subject metadata for `trellis.jobs@v1`.

/// Metadata for the `Jobs.Stream` subject.
pub struct JobsStreamSubject;

impl JobsStreamSubject {
    pub const KEY: &'static str = "Jobs.Stream";
    pub const SUBJECT: &'static str = "trellis.jobs.>";
}

