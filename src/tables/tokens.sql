CREATE TABLE tokens
(
    id         varchar(255) PRIMARY KEY,
    last_block bigint,
    supply     varchar(255)
);

CREATE TABLE balances
(
    token   varchar(255) REFERENCES tokens (id),
    account varchar(12),
    block   bigint,
    liquid_balance bigint,
    rex_stake bigint,
    resource_stake bigint,
    total_balance bigint,
    CONSTRAINT balances_pkey PRIMARY KEY (token, account)
);
