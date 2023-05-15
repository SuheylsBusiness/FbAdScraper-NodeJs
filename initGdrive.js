const { google } = require('googleapis');
const fs = require('fs');
const readline = require('readline');

// Load credentials from a JSON file
const credentials = require('./client_secret_732814265886-q4plijrbsfkoi73ce1tr6glnaas1s4c3.apps.googleusercontent.com.json');

// Scopes required for accessing Google Drive
const SCOPES = ['https://www.googleapis.com/auth/drive'];

async function initializeService() {
  try {
    // Create a new OAuth2 client
    const client = new google.auth.OAuth2(
      credentials.installed.client_id,
      credentials.installed.client_secret,
      credentials.installed.redirect_uris[0]
    );

    // Check if we have previously stored a token
    let token;
    try {
      token = fs.readFileSync('./token.json');
    } catch (err) {
      // If token doesn't exist, authorize and save the token
      token = await authorize(client);
      fs.writeFileSync('./token.json', token);
    }

    // Set the credentials and token for the client
    client.setCredentials(JSON.parse(token));

    // Create a new Drive service instance
    const drive = google.drive({ version: 'v3', auth: client });

    return drive;
  } catch (error) {
    console.error('Error initializing Google Drive API:', error);
    throw error;
  }
}

async function authorize(client) {
  try {
    // Generate the authorization URL
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });

    console.log('Authorize this app by visiting this URL:', authUrl);

    // Prompt the user to enter the authorization code
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const code = await new Promise((resolve, reject) => {
      rl.question('Enter the authorization code: ', (input) => {
        rl.close();
        resolve(input);
      });
    });

    // Exchange the authorization code for an access token
    const { tokens } = await client.getToken(code);
    return JSON.stringify(tokens);
  } catch (error) {
    console.error('Error authorizing the client:', error);
    throw error;
  }
}

module.exports = initializeService;
