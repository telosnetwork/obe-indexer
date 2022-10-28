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

