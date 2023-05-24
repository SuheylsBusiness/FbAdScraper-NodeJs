const { initializeGoogleSheet, readSpreadsheetEntries, clearSheet, appendIntoTopSpreadsheet, appendIntoSpreadsheet } = require("./googleSheetApi");
const { htmlDecode } = require("js-htmlencode");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { google } = require("googleapis");
const os = require("os");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getUrlsToMonitor(sheetsService, spreadsheetId) {
  const range = "Config!A2:A500";
  const entries = await readSpreadsheetEntries(range, sheetsService, spreadsheetId);
  const urls = entries.map((entry) => entry[0].toString());
  return urls;
}

function formatStringProperly(inputStr) {
  return htmlDecode(inputStr.toString()).trim();
}

async function downloadMedia(url, savePath) {
  try {
    const response = await axios.get(url, { responseType: "stream" });
    const writer = fs.createWriteStream(savePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  } catch (error) {
    console.error("Error occurred while downloading the media:", error);
    throw error;
  }
}

// Upload media files to Google Drive
async function uploadMediaFiles(mediaFolderId, imageFilenames, videoFilenames) {
  const driveClient = await initializeService();

  // Upload images
  for (const imageFilename of imageFilenames) {
    const imagePath = path.join(path.join(__dirname, "Media"), imageFilename);
    await uploadFileToDrive(driveClient, imagePath, mediaFolderId);
  }

  // Upload videos
  for (const videoFilename of videoFilenames) {
    const videoPath = path.join(path.join(__dirname, "Media"), videoFilename);
    await uploadFileToDrive(driveClient, videoPath, mediaFolderId);
  }
}

async function executeScrape(url, sheetsService, spreadsheetId, page) {
  // Create a Media folder if it doesn't exist
  const mediaFolderPath = path.join(__dirname, "Media");
  if (!fs.existsSync(mediaFolderPath)) {
    fs.mkdirSync(mediaFolderPath);
  }

  const options = {
    timeZone: "Europe/Berlin",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
  try {
    // Initialize variables
    let newAdsCount = 0,
      adsDisappearCount = 0,
      howManyAdsAppearedAgain = 0,
      totalAdCount = 0;
    const currentRecords = [];
    let allRecords = [];

    try {
      const range = "All Records!A2:O90000";
      const entries = await readSpreadsheetEntries(range, sheetsService, spreadsheetId);
      allRecords = entries.map((columns) => {
        const record = {};

        try {
          if (columns.length > 0) record.BrandName = formatStringProperly(columns[0]);
          if (columns.length > 1) record.AdStatus = formatStringProperly(columns[1]);
          if (columns.length > 2) record.CreativeId = formatStringProperly(columns[2]);
          if (columns.length > 3) record.AdHeader = formatStringProperly(columns[3]);
          if (columns.length > 4) record.AdCreative = formatStringProperly(columns[4]);
          if (columns.length > 5) record.CreativeAndBodyUse = formatStringProperly(columns[5]);
          if (columns.length > 6) record.Url = formatStringProperly(columns[6]);
          if (columns.length > 7) record.VersionInfo = formatStringProperly(columns[7]);
          if (columns.length > 8) record.FirstSeenTimestamp = formatStringProperly(columns[8]);
          if (columns.length > 9) record.LastUpdateTimestamp = formatStringProperly(columns[9]);
          if (columns.length > 10) record.StartedRunning = formatStringProperly(columns[10]);
          if (columns.length > 11) record.TotalRuntimeOfAd = formatStringProperly(columns[11]);
          if (columns.length > 12) record.DisappearedSince = formatStringProperly(columns[12]);
          if (columns.length > 13) record.HasAppearedAfterDisappearingDate = formatStringProperly(columns[13]);
          if (columns.length > 14) record.HistoryOfDisappearances = formatStringProperly(columns[14]);

          record.HasBeenTouched = "False";
        } catch (error) {
          console.error("Error occurred while formatting record", error);
        }

        return record;
      });
    } catch (error) {
      console.error("Error occurred while reading spreadsheet entries", error);
    }

    // Visit website and scroll down
    try {
      await page.waitForTimeout(2);
    } catch (err) {}
    try {
      await page.goto(url, { timeout: 0 });
    } catch (err) {
      //console.error("Error occurred while visiting url", err);
    }
    await sleep(2000);
    try {
      // Get all the buttons on the page
      const buttons = await page.$$('button[type="submit"]');

      // Click the last button on the page
      await buttons[buttons.length - 1].click();
    } catch (err) {}
    await sleep(2000);
    try {
      let previousHeight;
      while (true) {
        // Scroll down to the bottom of the page
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });

        // Wait for the page to load new content
        await page.waitForTimeout(1000);

        // Calculate the new height of the page and check if it's the same as the previous height
        const newHeight = await page.evaluate(() => document.body.scrollHeight);
        if (newHeight === previousHeight) {
          break;
        }
        previousHeight = newHeight;
      }
    } catch (err) {}

    // Get main attrs
    let companyName = "";
    try {
      companyName = await page.$eval('a[href] > div[role="heading"]', (el) => el.textContent.trim());
    } catch (error) {
      console.error(`Error occurred when getting company name: ${error.message}`);
      return;
    }

    // Loop through every record and perform logical operations
    const records = await page.$x("//hr/../../../div[not(contains(@class, ' '))]");

    try {
      await page.waitForTimeout(0);
    } catch (err) {}

    for (const record of records) {
      const tempRecord = {
        BrandName: companyName,
        AdStatus: "Active",
        FirstSeenTimestamp: new Date().toLocaleString("de-DE", options),
        LastUpdateTimestamp: new Date().toLocaleString("de-DE", options),
        HasBeenTouched: "True",
      };

      // Get images
      const images = await record.$$eval("img[referrerpolicy]", (elements) => elements.map((element) => element.getAttribute("src")));

      // Get videos
      const videos = await record.$$eval("video[src]", (elements) => elements.map((element) => element.getAttribute("src")));

      // Download and save images
      const imageFilenames = [];
      for (const image of images) {
        const imageUrl = new URL(image, url);
        const imageFilename = path.basename(imageUrl.pathname);
        const savePath = path.join(mediaFolderPath, imageFilename);
        await downloadMedia(imageUrl.href, savePath);
        imageFilenames.push(imageFilename);
      }

      // Download and save videos
      const videoFilenames = [];
      for (const video of videos) {
        const videoUrl = new URL(video, url);
        const videoFilename = path.basename(videoUrl.pathname) + "mp4";
        const savePath = path.join(mediaFolderPath, videoFilename);
        await downloadMedia(videoUrl.href, savePath);
        videoFilenames.push(videoFilename);
      }

      // Upload media files to Google Drive
      //const mediaFolderId = "13BPe2SaDaKTZwJob-GwWJDt_-BjpsYd6";
      //await uploadMediaFiles(mediaFolderId,imageFilenames,videoFilenames);

      const mediaFilenames = [...imageFilenames, ...videoFilenames].join(",");
      tempRecord.AdCreative = (record.AdCreative || "") + (record.AdCreative ? "," : "") + mediaFilenames;

      try {
        const spanElements = await record.$$("span");

        for (const spanElement of spanElements) {
          const innerText = await spanElement.evaluate((el) => el.innerText);

          if (innerText.includes("ID: ")) {
            const creativeId = innerText.replace("ID: ", "").trim().replace("\r\n", "");
            tempRecord.CreativeId = creativeId;
            break;
          }
        }
      } catch (error) {
        console.error(error);
      }

      try {
        tempRecord.AdHeader = await record.$eval('div[role="button"] > div[style]', (el) => el.textContent.trim().replace("\r\n", ""));
      } catch (error) {}

      try {
        tempRecord.Url = await record.$eval('a[data-lynx-mode="hover"]', (el) => el.getAttribute("href"));
      } catch (error) {}

      try {
        const creativeAndBodyUseElements = await record.$$("span");

        for (const creativeAndBodyUseElement of creativeAndBodyUseElements) {
          const text = await creativeAndBodyUseElement.evaluate((el) => el.textContent.trim());

          if (text.includes("use this creative and text")) {
            tempRecord.CreativeAndBodyUse = text.trim().replace("\r\n", "");
            break;
          }
        }
      } catch (error) {
        console.error(error);
      }

      try {
        const versionInfoElements = await record.$$("span");

        for (const versionInfoElement of versionInfoElements) {
          const text = await versionInfoElement.evaluate((el) => el.textContent.trim());

          if (text.includes("This ad has multiple versions")) {
            tempRecord.VersionInfo = text.trim().replace("\r\n", "");
            break;
          }
        }
      } catch (error) {
        console.error(error);
      }

      try {
        const startedRunningElements = await record.$$("span");
        let startedRunning = null;

        for (const startedRunningElement of startedRunningElements) {
          const text = await startedRunningElement.evaluate((el) => el.textContent.trim());

          if (text.includes("Started running on")) {
            startedRunning = text.replace("Started running on ", "").trim().replace("\r\n", "");
            break;
          }
        }

        if (startedRunning) {
          tempRecord.StartedRunning = startedRunning;
          tempRecord.TotalRuntimeOfAd = Math.round((new Date() - new Date(startedRunning)) / (1000 * 60 * 60 * 24), 2).toString() + " days";
        }
      } catch (error) {
        console.error(error);
      }

      let found = false;
      for (let i = 0; i < allRecords.length; i++) {
        if (allRecords[i].CreativeId == tempRecord.CreativeId) {
          if (allRecords[i].DisappearedSince && allRecords[i].DisappearedSince.length > 0) {
            howManyAdsAppearedAgain++;
            allRecords[i].HasAppearedAfterDisappearingDate = new Date().toLocaleString("de-DE", options);
            allRecords[i].DisappearedSince = "";

            allRecords[i].HistoryOfDisappearances = allRecords[i].HistoryOfDisappearances + `,[${new Date().toLocaleString("de-DE", options)}]: Ad has appeared.`;
          }
          tempRecord.FirstSeenTimestamp = allRecords[i].FirstSeenTimestamp;
          allRecords[i] = tempRecord;
          allRecords[i].HasBeenTouched = "True";
          found = true;
          break;
        }
      }
      if (!found) {
        allRecords.push(tempRecord);
        newAdsCount++;
      }

      currentRecords.push(tempRecord);
      totalAdCount++;
    }

    for (let i = 0; i < allRecords.length; i++) {
      if (allRecords[i].HasBeenTouched == "False" && companyName == allRecords[i].BrandName) {
        allRecords[i].DisappearedSince = new Date().toLocaleString("de-DE", options);
        allRecords[i].HistoryOfDisappearances = allRecords[i].HistoryOfDisappearances + `,[${new Date().toLocaleString("de-DE", options)}]: Ad has disappeared.`;
        adsDisappearCount++;
      }
    }

    // Finalize
    let dataToPost = [];
    for (let i = 0, r = 2; i < allRecords.length; i++, r++) {
      dataToPost.push(
        `\r\n${allRecords[i].BrandName || ""};%_` +
          `${allRecords[i].AdStatus || ""};%_` +
          `${allRecords[i].CreativeId || ""};%_` +
          `${allRecords[i].AdHeader || ""};%_` +
          `${allRecords[i].AdCreative || ""};%_` +
          `${allRecords[i].CreativeAndBodyUse || ""};%_` +
          `${allRecords[i].Url || ""};%_` +
          `${allRecords[i].VersionInfo || ""};%_` +
          `${allRecords[i].FirstSeenTimestamp || ""};%_` +
          `${allRecords[i].LastUpdateTimestamp || ""};%_` +
          `${allRecords[i].StartedRunning || ""};%_` +
          `${allRecords[i].TotalRuntimeOfAd || ""};%_` +
          `${allRecords[i].DisappearedSince || ""};%_` +
          `${allRecords[i].HasAppearedAfterDisappearingDate || ""};%_` +
          `${allRecords[i].HistoryOfDisappearances || ""}`
      );
    }
    dataToPost[0] = dataToPost[0].replace("\r\n", "");
    await clearSheet("All Records!A2:O900000", sheetsService, spreadsheetId);
    await appendIntoTopSpreadsheet(dataToPost, sheetsService, spreadsheetId, 2009049317);
    const dailyRecord = {
      Timestamp: new Date().toLocaleString("de-DE", options),
      Brand: companyName,
      TotalActiveAds: totalAdCount.toString(),
      HowManyNewAds: newAdsCount.toString(),
      HowManyAdsWithMultipleVersions: currentRecords.filter((x) => !!x.VersionInfo).length.toString(),
      HowManyAdsHaveDisappeared: adsDisappearCount.toString(),
      HowManyDisappearedAdsHaveAppeared: howManyAdsAppearedAgain.toString(),
    };
    await appendIntoSpreadsheet(
      "Daily Data!A2:G2",
      [
        dailyRecord.Timestamp,
        dailyRecord.Brand,
        dailyRecord.TotalActiveAds,
        dailyRecord.HowManyNewAds,
        dailyRecord.HowManyAdsWithMultipleVersions,
        dailyRecord.HowManyAdsHaveDisappeared,
        dailyRecord.HowManyDisappearedAdsHaveAppeared,
      ],
      sheetsService,
      spreadsheetId
    );
    console.log(`[FbAdScraper-NodeJs]: Finished Processing URL = '${url.slice(0, 50)}'. Total Ads = ${totalAdCount}`);
  } catch (error) {
    console.error(`Error occurred while executing scrape: ${error.message}`);
  }
}

(async () => {
  var sheetId = "17bdXoaOnG4nLl9E5APq56K_oCdY0jyobOYx7fcaSVZg";
  var gsheetService = await initializeGoogleSheet();
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--lang=en-US"],
    defaultViewport: { width: 1920, height: 1080 },
  });

  const page = await browser.newPage();

  while (true) {
    var urlsToMonitor = await getUrlsToMonitor(gsheetService, sheetId);
    for (const url of urlsToMonitor) {
      await executeScrape(url, gsheetService, sheetId, page);
    }
    // Wait for 24 hours
    await sleep(86400000);

    // Code below this line will be executed after 24 hours
    console.log("24 hours have passed!");
  }
})();
