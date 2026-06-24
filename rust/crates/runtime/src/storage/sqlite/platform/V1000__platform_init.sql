CREATE TABLE IF NOT EXISTS trellis_platform_store_marker (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO trellis_platform_store_marker (id) VALUES (1);
