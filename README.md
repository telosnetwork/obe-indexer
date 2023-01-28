# YAAI - Yet Another Antelope Indexer

## Developer Setup

### Docker

```bash
docker run \
    --name postgres \
    -p 5455:5432 \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres \
    -d \
    postgres
```

Then connect `psql -U postgres -h localhost -p 5455` and create the db

```postgresql
CREATE DATABASE obeindex;
CREATE USER obe WITH ENCRYPTED PASSWORD 'obe';
GRANT ALL PRIVILEGES ON DATABASE obeindex to obe;
```

Now paste all the tables in there and create those too, or write a script and put it

```bash
HERE
```

## Operator Setup

Nodeos Setup:  
The OBE Indexer does not have functionality for handeling forks so it must be pointed at a nodeos instance running in irreversible mode. More on that can be read here: https://developers.eos.io/manuals/eos/v2.2/nodeos/features/storage-and-read-modes

Within your nodeos config.ini file you will use with the indexer, be sure to include the option:  
```read-mode = irreversible```

Install node v.16  
```curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -```
```sudo apt-get install -y nodejs```

Install jq  
```sudo apt install jq```

Install Postgresql  
```sudo apt install postgresql postgresql-contrib```

Edit pg_hba.conf to allow password access locally  
```sudo vi /etc/postgresql/14/main/pg_hba.conf```

Change the below line under "local" to password from peer.  
```# "local" is for Unix domain socket connections only
local   all             all                                     password
```

Elevate to psql console  
```sudo -u postgres psql```

Create user and database:  
```create user USER with encrypted password 'PASSWORD';```  
```create database DBNAME;```  
```grant all privileges on database yaai to yaai;```  

Clone the OBE Indexer  
```git clone https://github.com/telosnetwork/obe-indexer```

Import tables as the DB user you just created using https://github.com/telosnetwork/obe-indexer/blob/master/src/tables/tokens.sql

Copy example.config.json to config.json and edit it for your DB, Hyp and Nodeos connection. Make sure to note the default port for psql is 5432. The config in git is set differently for the docker dev version. Also be sure the `nodeosUrl` is pointed to your node running in irreversible mode.

Install Yarn  
```sudo npm install --global yarn```

Install Dependencies  
```yarn ```

Buld the Indexer  
```yarn run build```

Run the Indexer  
```nohup node dist/indexer.js > obeIndexer.log 2>&1 &```



