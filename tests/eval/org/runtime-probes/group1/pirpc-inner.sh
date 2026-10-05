#!/usr/bin/env bash
# Feeds one prompt to `pi --mode rpc`, keeps stdin open long enough for the turn, then ends.
( printf '%s\n' '{"type":"prompt","message":"Reply with the single word ok."}'; sleep 15 ) | pi --mode rpc --model openrouter/poolside/laguna-s-2.1:free
