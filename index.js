// pass pid to orchestrator
console.log(`/VAR:PID:${process.pid}`);

("use strict");
console.log(
  "env: *HUBS_DOMAIN *HUBS_SID HUBS_EMAIL HUBS_FIRSTID HEADLESS=true/(false) AUTO_LOGIN=auto/manual/(disabled) CREDS=email1,token1;email2,token2 SPAWN_COUNT=(2) JITTER=(1) AUDIO_SAMPLES=(samples/sample000.mp3)"
);
const HEADLESS = process.env.HEADLESS === "true"; // true will hide the bot-spawing windows. default: false
// AUTO_LOGIN: auto: will open a visible window and automate yopmail login - yopmail is not hidden in case a captcha is required
//              manual: you need to open yopmail and click links
//              disabled (default): does not check for login
// note that this will use the same provided HUBS_EMAIL for every bot
// if you need separate accounts, use CREDS instead
const AUTO_LOGIN = process.env.AUTO_LOGIN;
const SPAWN_COUNT = parseInt(process.env.SPAWN_COUNT) || 2; // number of bots to spawn, min 1
const JITTER = parseFloat(process.env.JITTER) || 1.0; // 0~1 spawnCnt * jitter gives the min number of bots
// audio samples
const AUDIO_SAMPLES = process.env.AUDIO_SAMPLES
  ? process.env.AUDIO_SAMPLES.split(",")
  : [
      "samples/sample000.mp3",
      "samples/sample001.mp3",
      "samples/sample002.mp3",
      "samples/sample003.mp3",
      "samples/sample004.mp3",
      "samples/sample005.mp3",
      "samples/sample006.mp3",
      "samples/sample007.mp3",
    ];
// movement samples
const MOVEMENT_SAMPLES = ["samples/bot-recording.json"];

require("dotenv").config();
const HUBS_DOMAIN = process.env.HUBS_DOMAIN;
const HUBS_SID = process.env.HUBS_SID;
const HUBS_EMAIL = process.env.HUBS_EMAIL;
let HUBS_FIRSTID = parseInt(process.env.HUBS_FIRSTID) || undefined; //first bot id
if (!HUBS_DOMAIN || !HUBS_SID) {
  console.error(
    "Missing required env variables: HUBS_DOMAIN=hubs_external_domain ; HUBS_SID=hubs_room_id"
  );
  process.exit(1);
}
if (
  (AUTO_LOGIN === "auto" || AUTO_LOGIN === "manual") &&
  (!HUBS_EMAIL || HUBS_FIRSTID === undefined)
) {
  console.error(
    "Login requires env variables: HUBS_EMAIL=hubs_login_email ; HUBS_FIRSTID=first_bot_id_num"
  );
  process.exit(1);
}
HUBS_FIRSTID = HUBS_FIRSTID || 0;
const inst = { min: Math.floor(SPAWN_COUNT * JITTER) || 1, max: SPAWN_COUNT };
process.setMaxListeners(60);
const CREDS = process.env.CREDS && {};
if (CREDS) {
  let baseIndex = -1;
  for (const c of process.env.CREDS.replace(/;$/, "").split(";")) {
    const [email, token, ident] = c.split(",");
    CREDS[getAccId(++baseIndex)] = {
      email,
      token,
      ident,
    };
  }
  console.log(CREDS);
}
const queuer = require("./unbuf-promise-queue");
const puppeteer = require("puppeteer");
const path = require("path");
const mainQueue = queuer(0);
const emailQueue = queuer(1);

//randomly change queue size between min and max
if (JITTER < 1) {
  (async () => {
    for (;;) {
      mainQueue.setSize(
        inst.min + Math.floor(Math.random() * (inst.max - inst.min))
      );
      await new Promise((r) => setTimeout(r, 300000));
    }
  })();
} else {
  mainQueue.setSize(inst.max);
}

(async () => {
  //page array
  // const pages = new Map();
  let baseIndex = -1;
  let browser;
  //main loop
  for (;;) {
    //get and lock available slot
    baseIndex = (baseIndex + 1) % inst.max;
    const _id = getAccId(baseIndex);
    const accSid = (CREDS && CREDS[_id] && CREDS[_id].ident) || _id;
    console.log(`MAIN: ${accSid}: slot ${await mainQueue.waitOne()} available`);
    let freeUpSlot;
    const completionPromise = new Promise((r) => {
      freeUpSlot = r;
    });
    const { slot } = await mainQueue.add(() => completionPromise);
    //start job
    (async () => {
      let err = 1;
      do {
        let page;
        try {
          page = await createPage(accSid, { browser });
          // if (!browser) b9rowser = page.browser()
          if (AUTO_LOGIN === "auto" || AUTO_LOGIN === "manual" || CREDS) {
            //do login
            await checkLogin(page, true);
            let i = -1;
            const maxLoginRetry = 5;
            while (++i < maxLoginRetry && !(await checkLogin(page))) {
              console.log(`SLOT ${slot}: ${accSid}: login`);
              await login(page, accSid);
            }
            if (i === maxLoginRetry)
              throw new Error("login failed: too many retries");
            console.log(`SLOT ${slot}: ${accSid}: login OK`);
          }
          console.log(`SLOT ${slot}: ${accSid}: spawn`);
          page
            .goto(`https://${HUBS_DOMAIN}/${HUBS_SID}?bot=true&allow_multi`, {
              timeout: 210000,
            })
            .catch((e) => {});
          await page.waitForNavigation();
          //wait for room assignment
          // console.log("wait for assignment");
          await page.waitForNavigation();
          console.log(`SLOT ${slot}: ${accSid}: navigated to ${page.url()}`);
          //provide files for audio and data
          await Promise.race([
            new Promise(async (r, R) => {
              const res = await page
                .waitForSelector("div[class='exited-panel']", {
                  timeout: 200000,
                })
                .catch(() => {});
              if (res) R("session ended while waiting for spawn");
              else r();
            }),
            Promise.all([
              page
                .waitForSelector("a-scene", {
                  timeout: 180000,
                })
                .then((elh) =>
                  elh.evaluate((el) => el.setAttribute("visible", false))
                ),
              page
                .waitForSelector("input[id='bot-audio-input']", {
                  timeout: 180000,
                })
                .then((elh) =>
                  elh.uploadFile(
                    AUDIO_SAMPLES[
                      Math.floor(Math.random() * AUDIO_SAMPLES.length)
                    ]
                  )
                ),
              page
                .waitForSelector("input[id='bot-data-input']", {
                  timeout: 180000,
                })
                .then((elh) =>
                  elh.uploadFile(
                    MOVEMENT_SAMPLES[
                      Math.floor(Math.random() * MOVEMENT_SAMPLES.length)
                    ]
                  )
                ),
            ]),
          ]);
          console.log(`SLOT ${slot}: ${accSid}: spawn OK`);
          // await new Promise(r=>setTimeout(r,30000))
          // console.log( `JANUS SERVER\\${hubsSid}\\${ await page.evaluate(
          //   () =>
          //     NAF.connection.adapter.serverUrl
          // )}`)
          //hang out for a while
          const waitUntil =
            Date.now() + 900000 + Math.floor(Math.random() * 600000);
          let endNormal = true;
          do {
            if (
              await page
                .waitForSelector("div[class='exited-panel']", {
                  timeout: 4000,
                })
                .catch((e) => {})
            ) {
              endNormal = false;
              break;
            }
          } while (Date.now() < waitUntil);
          if (endNormal) console.log(`SLOT ${slot}: ${accSid}: session ended`);
          else
            console.error(
              `SLOT ${slot}: ${accSid}: session ended unexpectedly`
            );
          err = 0;
        } catch (e) {
          // err++;
          // if (err < 6) {
          console.error(
            `SLOT ${slot}: ${accSid}: error, retrying ${err}\nERROR${
              e.name ? " " + e.name : ""
            }: ${e.message}`
          );
          await new Promise((r) => setTimeout(r, 5000));
          // } else {
          //   console.log(`SLOT ${slot}: ${accSid}: too many retries, give up`);
          // }
        } finally {
          try {
            await page /*.browser()*/
              .close();
          } catch (e) {}
        }
      } while (err);
      // pages.delete(accSid)
      // freeUpSlot();
    })().then(async () => {
      await new Promise((r) => setTimeout(r, 5000));
      freeUpSlot();
    });
    //wait a bit before bringing in someone else
    await new Promise((r) =>
      setTimeout(r, 5000 + Math.floor(Math.random() * 9000))
    );
  }
})();

async function checkLogin(page, logout = false) {
  page
    .goto(`https://${HUBS_DOMAIN}`, {
      timeout: 70000,
    })
    .catch((e) => {});
  await page.waitForSelector("div[class^='index__sign-in__'] a span", {
    timeout: 40000,
  });
  //give time for login tag to update
  await new Promise((r) => setTimeout(r, 5000));
  let elh;
  if (
    ((elh = await page.$("div[class^='index__sign-in__'] a span")),
    await elh.evaluate((el) => el.innerText)) !== "Sign In"
  ) {
    if (!logout) return true;
    await elh.click();
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function login(page, accSid) {
  //not logged in
  if (CREDS) {
    //find corresponding CRED
    const cred =
      CREDS[accSid] ||
      Object.entries(CREDS).find(([_, { ident }]) => ident === accSid)[1];
    console.log(cred);
    await page.evaluate(
      ({ sleep, email, token }) => {
        (async () => {
          const t_o = 20000 / sleep;
          for (let i = 0; i < t_o; i++) {
            if (typeof APP !== "undefined" && APP.store && APP.store.state) {
              if (APP.store.state.credentials.token) {
                break;
              }
              APP.store.update({ credentials: { email, token } });
            }
            await new Promise((r) => setTimeout(r, sleep));
          }
        })();
      },
      {
        sleep: 100,
        email: cred.email,
        token: cred.token,
      }
    );
  } else if (AUTO_LOGIN === "auto") {
    console.log(`EMAIL: ${accSid}: wait for slot`);
    await emailQueue
      .add(async () => {
        console.log(`EMAIL: ${accSid}: slot available`);
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
        await page.keyboard.type(HUBS_EMAIL);
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
        for (;;) {
          //refresh
          await pageEmail.click("span[class='mgif irefresh b'");
          //check if any email every few secs
          await ifinbox
            .waitForFunction(() => !!document.querySelector("div[id='m1']"), {
              polling: 500,
              timeout: 7500,
            })
            .catch((e) => {});
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
          .catch((e) => {});
        const link = await pageEmailContent
          .waitForSelector("div[id='mailmillieu'] a", { timeout: 40000 })
          .then((elh) => elh.evaluate((el) => el.href));
        pageEmailContent.close();
        //open confirmation link
        console.log("open new page: conf link");
        const pageConfirm = await page.browser().newPage();
        pageConfirm.goto(link, { timeout: 70000 }).catch((e) => {});
        await pageConfirm.waitForFunction(
          () => {
            const el = document.querySelector(
              "div[class='dialog__box__contents__title']"
            );
            return !!el && el.innerText === "Email Verified!";
          },
          { polling: 500, timeout: 40000 }
        );
        pageConfirm.close();
      })
      .then(({ promise }) => promise);
  } else {
    //request login email
    await page.click("button[class^='sign-in-dialog__next-button__'");
    //wait for validation
    //refresh
    //check if any email every few secs
    await ifinbox.waitForFunction(
      () =>
        document.querySelector("div[class^='index__sign-in__'] a span")
          .innerText === "Sign Out",
      {
        polling: 500,
        timeout: 300000,
      }
    );
  }
}

async function getEmailPage(accSid) {
  let page = getEmailPage.page;
  if (page) {
    clearTimeout(getEmailPage.unInitTimeout);
  } else {
    // console.log("new browser instance: mailbox");
    getEmailPage.page = page = await createPage(
      `${accSid.substr(0, 3)}_email`,
      { headless: false, width: 1000, height: 500 }
    );
    page
      .goto("http://www.yopmail.com/en/", {
        timeout: 70000,
      })
      .catch((e) => {});
    await page
      .waitForSelector("input[id='login']", {
        timeout: 40000,
      })
      .then((elh) =>
        elh.evaluate(async (el, v) => {
          el.value = v;
        }, HUBS_EMAIL)
      );
    await page
      .waitForSelector("input[class='sbut']", {
        timeout: 40000,
      })
      .then((elh) => elh.click());
    await new Promise((r) => setTimeout(r, 1000));
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
    page = undefined;
  }, 180000);
  //ready
  return page;
}

async function createPage(context, options = {}) {
  options = { headless: HEADLESS, width: 360, height: 720, ...options };
  // console.log("new browser instance: " + context);
  let browser;
  let page;
  if (options.browser) {
    browser = options.browser;
    page = await browser.newPage();
  } else {
    browser = await puppeteer.launch({
      headless: options.headless,
      userDataDir: process.env.TMP + path.sep + context,
      args: [
        //'--single-process',
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
      // ignoreDefaultArgs: ["--enable-features=NetworkService,NetworkServiceInProcess"]
    });
    page = await browser.newPage({ context });
    for (const p of await browser.pages()) {
      if (page !== p) p.close();
    }
  }
  await page.setViewport({
    width: options.width || 360,
    height: options.height || 720,
  });
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

function getAccId(baseIndex) {
  return "" + (HUBS_FIRSTID + baseIndex).toString().padStart(5, "0");
}
