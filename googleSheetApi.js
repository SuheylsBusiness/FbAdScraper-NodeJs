
const { google } = require('googleapis');
const { promisify } = require('util');
const { readFile } = require("fs/promises");
const path = require("path");
const sleep = promisify(setTimeout);
const { JWT } = require('google-auth-library');
const keys = require('./googleSheetApiAuth.json');

async function initializeGoogleSheet() {
    const client = new JWT({
      email: keys.client_email,
      key: keys.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  
    await client.authorize();
  
    const sheetService = google.sheets({ version: 'v4', auth: client });
  
    return sheetService;
  }
  async function readSpreadsheetEntries(range, sheetsService, spreadsheetId) {
    const maxRetryCount = 5;
    const retryDelayMilliseconds = 60000; // 1 minute
  
    for (let retryCount = 0; retryCount < maxRetryCount; retryCount++) {
      try {
        const request = {
          spreadsheetId,
          range,
        };
  
        const response = await sheetsService.spreadsheets.values.get(request);
        const values = response.data.values;
  
        await sleep(2000);
  
        return values;
      } catch (error) {
        console.error(`Error occurred while reading spreadsheet: ${error.message}`);
  
        if (retryCount < maxRetryCount - 1) {
          console.error(`Retrying in ${retryDelayMilliseconds / 1000} seconds...`);
          await sleep(retryDelayMilliseconds);
        } else {
          console.error("Max retry count exceeded for gsheet communication. Aborting...");
        }
      }
    }
  
    return null;
  }
  async function appendIntoTopSpreadsheet(objects, sheetService, googleSheet_sheetID, sheetId) {
    const maxRetryCount = 5;
    const retryDelayMilliseconds = 60000; // 1 minute
  
    for (let retryCount = 0; retryCount < maxRetryCount; retryCount++) {
      try {
        const insertRow = {
          insertDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: 1,
              endIndex: 2,
            },
          },
        };
  
        const data = {
          pasteData: {
            data: objects.join(";%_"),
            delimiter: ";%_",
            coordinate: {
              columnIndex: 0,
              rowIndex: 1,
              sheetId,
            },
          },
        };
  
        const requests = [insertRow, data];
  
        const response = await sheetService.spreadsheets.batchUpdate({
          spreadsheetId: googleSheet_sheetID,
          requestBody: {
            requests,
          },
        });
  
        await new Promise(resolve => setTimeout(resolve, 2000));
  
        return;
      } catch (error) {
        console.error(`Error occurred while appending to top of spreadsheet: ${error.message}`);
  
        if (retryCount < maxRetryCount - 1) {
          console.log(`Retrying in ${retryDelayMilliseconds / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryDelayMilliseconds));
        } else {
          console.error("Max retry count exceeded. Aborting...");
        }
      }
    }
  }
  async function appendIntoSpreadsheet(range, objects, sheetsService, spreadsheetId) {
    const maxRetryCount = 5;
    const retryDelayMilliseconds = 60000; // 1 minute
  
    for (let retryCount = 0; retryCount < maxRetryCount; retryCount++) {
      try {
        const valueRange = {
          values: [objects],
        };
  
        const appendRequest = {
          spreadsheetId,
          range,
          valueInputOption: "USER_ENTERED",
          resource: valueRange,
        };
  
        const appendResponse = await sheetsService.spreadsheets.values.append(appendRequest);
  
        await sleep(2000);
  
        return;
      } catch (error) {
        console.error(`Error occurred while appending to spreadsheet: ${error.message}`);
  
        if (retryCount < maxRetryCount - 1) {
          console.error(`Retrying in ${retryDelayMilliseconds / 1000} seconds...`);
          await sleep(retryDelayMilliseconds);
        } else {
          console.error("Max retry count exceeded. Aborting...");
        }
      }
    }
  }
  
  async function clearSheet(range, sheetsService, spreadsheetId) {
    // TODO: Assign values to desired properties of `requestBody`:
    const requestBody = {};
  
    const request = {
      requestBody,
      spreadsheetId,
      range,
    };
  
    const response = await sheetsService.spreadsheets.values.clear(request);
  }

  module.exports = {
    initializeGoogleSheet,
    readSpreadsheetEntries,
    clearSheet,
    appendIntoTopSpreadsheet,
    appendIntoSpreadsheet,
  };