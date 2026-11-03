FROM docker.elastic.co/elasticsearch/elasticsearch:8.17.0

ENV discovery.type=single-node \
    xpack.security.enabled=false \
    ES_JAVA_OPTS="-Xms1g -Xmx1g" \
    node.store.allow_mmap=false

EXPOSE 9200
