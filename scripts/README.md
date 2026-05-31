# API test script

## Run tests

1. **Start the server** (in one terminal):
   ```bash
   cd backend
   npm start
   ```
2. **Run the tests** (in another terminal):
   ```bash
   cd backend
   npm run test:api
   ```
   Or: `node scripts/test-api.js`

The script will wait up to ~11 seconds for the server to respond, then run all flows: health, auth, venues, categories, events, ticket categories, bookings, resale (White Market), and reviews.

## If "Register" returns 500

- Ensure the **User** collection in **EventManagementDB** does **not** require `UserID` (we use only MongoDB `_id`). In Compass: User collection → Validation → remove `UserID` from the `required` array (or drop the validator).

## If "Authorization token missing" appears

- That usually means register/login failed earlier, so no token was saved. Fix the auth step (e.g. validator above) and run again.
