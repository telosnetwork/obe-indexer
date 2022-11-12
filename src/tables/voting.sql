CREATE TABLE voters
(
    voter       varchar(12),
    last_block  bigint,
    producers   varchar(12)[],
    vote_weight bigint,
    CONSTRAINT voter_pkey PRIMARY KEY (voter)
);

CREATE TABLE producer_snapshot
(
    date        timestamp PRIMARY KEY,
    snapshot    jsonb
);
