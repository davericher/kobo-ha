docker build -t ir0ny/kobo-ha-dashboard:0.1.8 .
docker tag ir0ny/kobo-ha-dashboard:0.1.8 ir0ny/kobo-ha-dashboard:latest
docker push ir0ny/kobo-ha-dashboard:0.1.8
docker push ir0ny/kobo-ha-dashboard:latest
