docker build -t ir0ny/kobo-ha-dashboard:0.1.9 .
docker tag ir0ny/kobo-ha-dashboard:0.1.9 ir0ny/kobo-ha-dashboard:latest
docker push ir0ny/kobo-ha-dashboard:0.1.9
docker push ir0ny/kobo-ha-dashboard:latest
