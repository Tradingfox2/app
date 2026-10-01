# Centrifugo v6 with the repo config. Secrets and the listen port come from
# the environment (see deploy/centrifugo/README.md and render.yaml), which
# overrides the placeholder values in config.json.
FROM centrifugo/centrifugo:v6.9.6

COPY config.json /centrifugo/config.json

ENTRYPOINT ["centrifugo"]
CMD ["-c", "/centrifugo/config.json"]
