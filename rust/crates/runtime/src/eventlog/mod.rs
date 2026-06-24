//! Eventlog subsystem scaffold.

use std::time::Duration;

use crate::shutdown::StopHandle;
use crate::supervisor::{RuntimeContext, RuntimeError, SubsystemHandle};
use crate::SubsystemName;

pub(crate) fn start(_context: &RuntimeContext) -> Result<SubsystemHandle, RuntimeError> {
    let stop = StopHandle::new();
    let task_stop = stop.clone();
    let join = tokio::spawn(async move {
        while !task_stop.is_stopped() {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Ok(())
    });

    Ok(SubsystemHandle {
        name: SubsystemName::Eventlog,
        stop,
        join,
    })
}
