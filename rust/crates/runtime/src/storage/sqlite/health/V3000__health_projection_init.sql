CREATE TABLE IF NOT EXISTS trellis_health_projection_store_marker (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO trellis_health_projection_store_marker (id) VALUES (1);
