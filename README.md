# hubs-puppet
This is a node.js script to spawn multiple bots in Mozilla Hubs rooms, it handles logging in with a yopmail account for private rooms.
To use:
- add audio samples to the /samples folder and change audioSamples value in index.js
- add a .env file with:
  HUBS_DOMAIN=hubs_external_domain
  HUBS_SID=room_id
  HUBS_EMAIL=hubs_account@email.com
- see other constants at the top of index.js for fine-tuning
- run: node index.js

# Notes:
Despite using the ?bot=true functionality, maintaining bots is still cpu intensive, try with a low spawn count to start with.
