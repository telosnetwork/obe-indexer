CREATE TABLE sync_status
(
    block     bigint,
    action    varchar(64),
    poller    varchar(64),
    CONSTRAINT sync_status_pkey PRIMARY KEY (action, poller)
);
