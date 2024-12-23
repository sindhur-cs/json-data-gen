import axios from "axios";
import { randomUUID } from "crypto";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config();

const API_BASE_URL = "https://app.contentstack.com/api/v3/content_types";
const API_URL = "https://api.contentstack.io/v3";
const DEPTH = 5;

const processedEntries = new Set();
const skippedEntries = [];

const getLocalesUrl = `${API_URL}/locales?include_count=false`;

async function fetchDescendants(
  contentTypeUid,
  entryUid,
  apiKey,
  authtoken,
  localeData,
  parentEntryUid = null
) {
  if (processedEntries.has(entryUid)) {
    console.log(`Skipping already processed entryUid: ${entryUid}`);
    if (parentEntryUid) {
      skippedEntries.push({ parentEntryUid, skippedEntryUid: entryUid });
    }
    return { entries_references: [] };
  }

  const headers = {
    api_key: apiKey,
    authtoken: authtoken,
    "Content-Type": "application/json",
  };

  try {
    const response = await Promise.all(localeData.locales.map(async locale => {
      const entryUID = entryUid.split("-")[0];
      const res = await axios.get(`${API_BASE_URL}/${contentTypeUid}/entries/${entryUID}/descendants?locale=${locale.code}&depth=${DEPTH}`, { headers })
      res.data.actualLocale = locale.code; 
      res.data.fallback = locale.fallback_locale;
      return res;
    }));

    const modifiedArray = response.map(res => {
      if (!res.data.uid.includes(res.data.locale.split("-")[0])) {
        res.data.uid = res.data.uid + "-" + res.data.locale.split("-")[0];
      }
      processedEntries.add(res.data.uid);
      console.log(res.data);
      return res.data;
    });

    // const response = await axios.get(url, { headers });
    return modifiedArray;
  } catch (error) {
    throw error;
  }
}

async function loginAndFetch(mail, pass) {
  const loginData = {
    user: {
      email: mail,
      password: pass,
    },
  };
  const loginUrl = "https://api.contentstack.io/v3/user-session";
  const loginRes = await axios.post(loginUrl, loginData);
  return loginRes.data.user.authtoken;
}

async function fetchNestedReferences(
  contentTypeUid,
  entryUid,
  apiKey,
  authtoken,
  localeData
) {
  const dataArray = await fetchDescendants(
    contentTypeUid,
    entryUid,
    apiKey,
    authtoken,
    localeData
  );

  console.log("dataARRAY", dataArray);

  if (!Array.isArray(dataArray) || dataArray.length === 0) {
    return {};
  }

  const localizedEntries = await Promise.all(
    dataArray.map(async (data) => {
      const references = await Promise.all(
        (data.entries_references || []).map(async (entry) => {
          const childData = entry.has_child
            ? await fetchNestedReferences(
                entry._content_type_uid,
                `${entry.uid}-${entry.locale.split("-")[0]}`,
                apiKey,
                authtoken,
                localeData
              )
            : {};

          return {
            title: entry.title,
            content_type_uid: entry._content_type_uid,
            entry_uid: `${entry.uid}-${entry.locale.split("-")[0]}`,
            // localized entries added recursively
            ...(childData.localized_entries && {
              localized_entries: childData.localized_entries,
            }),
          };
        })
      );

      console.log("DATA", data);

      return {
        ...(data.actualLocale && data.locale !== data.actualLocale ? {
          locale: data.actualLocale.split("-")[0].toUpperCase(),
          fallback: data.locale.split("-")[0].toUpperCase(),
        } : {
          locale: data.locale.split("-")[0].toUpperCase(),
        }),
        content_type_uid: "localise",
        entry_uid: data.entry_uid || randomUUID(),
        references,
      };
    })
  );

  const defaultData = dataArray.find((data) =>
    data.locale.includes("en")
  ) || dataArray[0];

  return {
    title: defaultData.title,
    content_type_uid: defaultData._content_type_uid,
    entry_uid: defaultData.uid,
    localized_entries: localizedEntries,
  };
}

// Usage example
const contentTypeUid = process.env.CONTENT_TYPE_UID;
const entryUid = process.env.ENTRY_UID;
const apiKey = process.env.API_KEY;
const mail = process.env.MAIL;
const pass = process.env.PASSWORD;

loginAndFetch(mail, pass)
  .then(async (authtoken) => {
    const localesResponse = await axios.get(getLocalesUrl,
      {
        headers: {
          api_key: apiKey,
          authtoken,
          "Content-Type": "application/json",
        }
      });

    const localeData = await localesResponse.data;

    console.log("LOCAL", localeData);
    const res = fetchNestedReferences(contentTypeUid, entryUid, apiKey, authtoken, localeData);
    return res;
  })
  .then((result) => {
    console.log("RESULT", result);
    if (result) {
      // console.log("Fetched data:", JSON.stringify(result, null, 2));
      // console.log("Skipped entries:", JSON.stringify(skippedEntries, null, 2));

      // Store the result into a file.json
      fs.writeFileSync("result.json", JSON.stringify(result, null, 2), "utf-8");
      // console.log("Result has been written to result.json");
    }
  })
  .catch((error) => {
    console.error("Error during fetching data:", error);
  });
