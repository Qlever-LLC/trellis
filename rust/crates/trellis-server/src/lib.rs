//! Low-level inbound Trellis runtime primitives for generated Rust code.

mod descriptor;
mod error;
mod publisher;
mod router;

pub use descriptor::{EventDescriptor, RpcDescriptor};
pub use error::{HandlerResult, ServerError};
pub use publisher::EventPublisher;
pub use router::{RequestContext, Router};
