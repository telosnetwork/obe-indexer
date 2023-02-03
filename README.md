# OBE Indexer - Antelope Indexer for Open Block Explorer

This is an Antelope indexer developed for our [Open Block Explorer](https://github.com/telosnetwork/open-block-explorer)

## Requirement

This repository's instructions requires Docker to be installed but alternatively you can install Postgres without it.

## Developer Setup

**Install node v.16**

```curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -```
```sudo apt-get install -y nodejs```

**Clone the OBE Indexer**

```git clone https://github.com/telosnetwork/obe-indexer```

**Copy example.config.json to config.json and edit it for your DB, Hyp and Nodeos connection.**

Make sure to note the default port for psql is 5432. The config in git is set differently for the docker dev version. Also be sure the `nodeosUrl` is pointed to your node running in irreversible mode.

```read-mode = irreversible```

**Copy .env.sample to .env**

Configure the mode (dev|prod) & log levels for indexer and api

**Install Yarn** 

```sudo npm install --global yarn```

**Install Dependencies** 

```yarn ```

**Setup postgres** 

Using `bash runDockerPostgres.sh` or

```bash
docker run \
    --name postgres \
    -p 5455:5432 \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres \
    -d \
    postgres
```

Then connect `psql -U postgres -h localhost -p 5455` and create the database and privileged user by pasting the following snippet:

```postgresql
CREATE DATABASE obeindex;
CREATE USER obe WITH ENCRYPTED PASSWORD 'obe';
GRANT ALL PRIVILEGES ON DATABASE obeindex to obe;
```

Now paste all the tables defined in `src/tables` and create those too, or write a script to do it

```bash
HERE
```

## Nodeos Setup

The OBE Indexer does not have functionality for handling forks so it must be pointed at a nodeos instance running in irreversible mode. More on that can be read here: https://developers.eos.io/manuals/eos/v2.2/nodeos/features/storage-and-read-modes

Within your nodeos config.ini file you will use with the indexer, be sure to include the option:  

```read-mode = irreversible```

## Build
Build the Indexer with

```yarn run build```

## Run
Run the Indexer with 

```nohup node dist/indexer.js > obeIndexer.log 2>&1 &```

Run the API with

```nohup node dist/api.js > obeApi.log 2>&1 &```



