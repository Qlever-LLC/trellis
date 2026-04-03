pub trait JobEventPublisher {
    type Error;

    fn publish(
        &self,
        subject: String,
        payload: Vec<u8>,
    ) -> impl std::future::Future<Output = Result<(), Self::Error>> + Send;
}
