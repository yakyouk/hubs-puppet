# hubs-puppet
## Run:
This is a node.js script to spawn multiple bots in Mozilla Hubs rooms, it handles logging in with a yopmail account for private rooms.
To use:
* add audio samples to the `/samples` folder and change audioSamples value in `index.js`
* add a .env file with:
```
HUBS_DOMAIN=hubs_external_domain (required)
HUBS_SID=room_id (required)
HUBS_EMAIL=hubs_account@email.com (required if AUTO_LOGIN)
HUBS_FIRSTID=first_bot_id_number
HEADLESS=true_or_false
AUTO_LOGIN=auto_manual_disabled
SPAWN_COUNT=number_of_bots_to_spawn
JITTER=spawn_count_multiplier (value between 0 and 1; total bot count will vary between SPAWN_COUNT*JITTER and SPAWN_COUNT)
AUDIO_SAMPLES=comma_separated_list_of_sample_files
```
* see other constants at the top of `index.js` for fine-tuning
* run: `node index.js`

## Notes:
Despite using the `?bot=true` functionality, maintaining bots is still cpu intensive, try with a low spawn count to start with.
