
"use strict";

const g_headless = true;
const spawnCnt = 5;
const audioSamples = ["samples/sample000.mp3", "samples/sample001.mp3", "samples/sample002.mp3", "samples/sample003.mp3", "samples/sample004.mp3", "samples/sample005.mp3", "samples/sample006.mp3", "samples/sample007.mp3"]
const movementSamples = ["samples/bot-recording.json"]

require("dotenv").config();
const hubsDomain = process.env.HUBS_DOMAIN
const hubsSid = process.env.HUBS_SID
const email = process.env.HUBS_EMAIL
if (!hubsDomain || !hubsSid || !email) {
  console.error(`Please add these environment variables to .env file:
  HUBS_DOMAIN=hubs_external_domain
  HUBS_SID=room_id
  HUBS_EMAIL=hubs_account@email.com`)
  process.exit(1)
}

const queuer = require("./unbuf-promise-queue");
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const inst = { min: Math.floor(spawnCnt * 0.8), max: spawnCnt }
const mainQueue = queuer(0);
const emailQueue = queuer(1);
process.setMaxListeners(40);
// let browser


//randomly change queue size between min and max
(async () => {
  for (; ;) {
    mainQueue.setSize(inst.min + Math.floor(Math.random() * (inst.max - inst.min)));
    await new Promise((r) => setTimeout(r, 300000));
  }
})();

(async () => {
  //page array
  // const pages = new Map();
  let accId = -1;
  //main loop
  for (; ;) {
    //get and lock available slot
    accId = (accId + 1) % inst.max;
    const accSid = "a" + accId.toString().padStart(4, "0")
    console.log(`MAIN: ${accSid}: slot ${await mainQueue.waitOne()} available`);
    let freeUpSlot;
    const completionPromise = new Promise((r) => {
      freeUpSlot = r;
    });
    const { slot } = await mainQueue.add(() => completionPromise);
    //start job
    (async () => {
      let page;
      let err;
      err = 1;
      do {
        try {
          page = await createPage(accSid);
          //do login
          console.log(`SLOT ${slot}: ${accSid}: login`);
          await login(page, accSid);
          /*
          //change display name
          page
            .goto(`https://${hubsDomain}/${hubsSid}`, {
              timeout: 70000,
            })
            .catch((e) => {});
          await page
            .waitForSelector("a-scene", { timeout: 40000 })
            .then((elh) =>
              elh.evaluate((el) => el.setAttribute("visible", false))
            );
          await page
            .waitForSelector(
              "button[class^='ui-root__presence-list-button__']",
              {
                timeout: 40000,
              }
            )
            .then((elh) => elh.click());
          await page
            .waitForSelector("a[class^='presence-list__self__']", {
              timeout: 40000,
            })
            .then((elh) => elh.click());
          await page.waitForSelector("input[id='profile-entry-display-name']", {
            timeout: 40000,
          });
          await page.focus("input[id='profile-entry-display-name']");
          await page.keyboard.type(accSid);
          await page.waitForSelector("input[class^='profile__form-submit__']", {
            timeout: 40000,
          });
          await page.click("input[class^='profile__form-submit__']");
          await new Promise((r) => setTimeout(r, 1000));
        */
          console.log(`SLOT ${slot}: ${accSid}: login OK`);
          console.log(`SLOT ${slot}: ${accSid}: spawn`);
          page
            .goto(`https://${hubsDomain}/${hubsSid}?bot=true&allow_multi`, {
              timeout: 70000,
            })
            .catch((e) => { });
          //provide files for audio and data
          await Promise.all([
            page
              .waitForSelector("input[id='bot-audio-input']", {
                timeout: 70000,
              })
              .then((elh) => elh.uploadFile(audioSamples[Math.floor(Math.random() * audioSamples.length)])),
            page
              .waitForSelector("input[id='bot-data-input']", { timeout: 70000 })
              .then((elh) => elh.uploadFile(movementSamples[Math.floor(Math.random() * movementSamples.length)])),
          ]);
          console.log(`SLOT ${slot}: ${accSid}: spawn OK`);
          //hang out for a while
          const waitUntil = Date.now() + 600000 + Math.floor(Math.random() * 300000)
          do {
            if (await page.waitForSelector("div[class='exited-panel']", { timeout: 15000 }).catch(e => { })) {
              console.error(`SLOT ${slot}: ${accSid}: session ended unexpectedly`)
              break;
            }
          } while (Date.now() < waitUntil)
          console.log(`SLOT ${slot}: ${accSid}: session ended`)
          err = 0;
        } catch (e) {
          err++;
          console.error(
            `SLOT ${slot}: ${accSid}: error, retrying ${err}\nERROR${
            e.name ? " " + e.name : ""
            }: ${e.message}`
          );
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (err === 6) {
          console.log(`SLOT ${slot}: ${accSid}: too many retries, give up`)
          try { await page.browser().close() } catch (e) { }
          return
        }
      } while (err);
      try { await page.browser().close() } catch (e) { }
      // pages.delete(accSid)
      // freeUpSlot();
    })().then(async () => {
      await new Promise((r) =>
        setTimeout(r, 5000)
      );
      freeUpSlot()
    });
    //wait a bit before bringing in someone else
    await new Promise((r) =>
      setTimeout(r, 1000 + Math.floor(Math.random() * 9000))
    );
  }
})();

async function login(page, accSid) {
  //check if require login
  page
    .goto(`https://${hubsDomain}`, {
      timeout: 70000,
    })
    .catch((e) => { });
  await page.waitForSelector("div[class^='index__sign-in__'] a span", {
    timeout: 40000,
  });
  //give time for login tag to update 
  await new Promise((r) => setTimeout(r, 2000));
  if (
    (await page
      .$("div[class^='index__sign-in__'] a span")
      .then((elh) => elh.evaluate((el) => el.innerText))) !== "Sign In"
  ) return;
  //not logged in
  console.log(`EMAIL: ${accSid}: wait for slot`)
  await emailQueue.add(async () => {
    console.log(`EMAIL: ${accSid}: slot available`)
    const pageEmail = await getEmailPage(accSid);
    //fill in email
    await page
      .$("div[class^='index__sign-in__'] a span")
      .then((elh) => elh.click());
    await page.waitForSelector(
      "input[class^='sign-in-dialog__email-field__']",
      {
        timeout: 40000,
      }
    );
    await page.focus("input[class^='sign-in-dialog__email-field__']");
    await page.keyboard.type(email);
    await page.waitForSelector(
      "button[class^='sign-in-dialog__next-button__'",
      {
        timeout: 40000,
      }
    );
    //request login email
    await page.click("button[class^='sign-in-dialog__next-button__'");
    //wait for incoming email
    const t0 = new Date();
    await new Promise((r) => setTimeout(r, 1000));
    //get inbox iframe
    const ifinbox = await pageEmail
      .$("iframe[id='ifinbox']")
      .then((elh) => elh.contentFrame());
    let emailContentLink;
    for (; ;) {
      //refresh
      await pageEmail.click("span[class='mgif irefresh b'");
      //check if any email every few secs
      await ifinbox
        .waitForFunction(() => !!document.querySelector("div[id='m1']"), {
          polling: 500,
          timeout: 7500,
        })
        .catch((e) => { });
      const elh = await ifinbox.$("div[id='m1'] a");
      if (elh) {
        //u got mail
        emailContentLink = await elh.evaluate((el) => el.href);
        break;
      }
      //timeout?
      if (new Date() > t0 + 120000) throw new Error("Timeout: wait email");
    }
    //open email body
    console.log("open new page: email body");
    const pageEmailContent = await pageEmail.browser().newPage();
    pageEmailContent
      .goto(emailContentLink, { timeout: 70000 })
      .catch((e) => { });
    const link = await pageEmailContent
      .waitForSelector("div[id='mailmillieu'] a", { timeout: 40000 })
      .then((elh) => elh.evaluate((el) => el.href));
    pageEmailContent.close();
    //open confirmation link
    console.log("open new page: conf link");
    const pageConfirm = await page.browser().newPage();
    pageConfirm.goto(link, { timeout: 70000 }).catch((e) => { });
    await pageConfirm.waitForFunction(() => {
      const el = document.querySelector(
        "div[class='dialog__box__contents__title']"
      );
      return !!el && el.innerText === "Email Verified!";
    }, { polling: 500, timeout: 40000 });
    pageConfirm.close();
  }).then(({ promise }) => promise)
}

async function getEmailPage(accSid) {
  let page = getEmailPage.page;
  if (page) {
    clearTimeout(getEmailPage.unInitTimeout);
  } else {
    // console.log("new browser instance: mailbox");
    getEmailPage.page = page = await createPage(`${accSid.substr(0, 3)}_email`, { headless: false, width: 1000, height: 500 });
    page
      .goto("http://www.yopmail.com/en/", {
        timeout: 70000,
      })
      .catch((e) => { });
    await page
      .waitForSelector("input[id='login']", {
        timeout: 40000,
      })
      .then((elh) =>
        elh.evaluate(async (el, v) => {
          el.value = v;
        }, email)
      );
    await page
      .waitForSelector("input[class='sbut']", {
        timeout: 40000,
      })
      .then((elh) => elh.click());
    await new Promise(r => setTimeout(r, 1000))
  }
  //wait nav to inbox
  const ifinbox = await page
    .waitForSelector("iframe[id='ifinbox']", {
      timeout: 40000,
    })
    .then((elh) => elh.contentFrame());
  //wait frame load
  await ifinbox.waitForSelector("div[class='igif tirj']", {
    timeout: 40000,
  });
  //clear any email
  if (await ifinbox.$("div[id='m1']")) {
    const clearInbox = await ifinbox.$("a[class='igif lmen_all']");
    await clearInbox.evaluate((el) => el.click());
    await new Promise((r) => setTimeout(r, 1000));
    await ifinbox.waitForFunction(
      () => !document.querySelector("div[id='m1']"),
      { polling: 500, timeout: 40000 }
    );
  }
  //destroy after N min
  getEmailPage.unInitTimeout = setTimeout(async () => {
    getEmailPage.page = undefined;
    page.browser().close();
    page = undefined
  }, 180000);
  //ready
  return page;
}

async function createPage(context, options = {}) {
  options = { headless: g_headless, width: 360, height: 720, ...options }
  // console.log("new browser instance: " + context);
  let browser
  let page
  if (options.browser) {
    browser = options.browser
    page = await browser.newPage();
  } else {
    browser = await puppeteer.launch({
      headless: options.headless,
      userDataDir: process.env.TMP + path.sep + context,
      executablePath: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    });
    page = await browser.newPage({ context });
    for (const p of await browser.pages()) {
      if (page !== p) p.close();
    }
  }
  await page.setViewport({ width: options.width || 360, height: options.height || 720 });
  // page.setDefaultNavigationTimeout(0);
  // await page.setRequestInterception(true);
  // page.on("request", (req) => {
  //   if (
  //     // req.url().includes("google-analytics.com") ||
  //     options.blockImg &&
  //     req.resourceType() === "image"
  //     //   req.url().includes("histats.com")
  //   ) {
  //     req.abort();
  //   } else {
  //     // if (dispreq) console.log(req.url());
  //     req.continue();
  //   }
  // });
  // page.on("dialog", (dlg) => {
  //   console.log(`DISMISSED DLG '${dlg.message()}'`);
  //   dlg.accept();
  // });
  return page;
}