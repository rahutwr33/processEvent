const sanitizeHtml = require('sanitize-html');
const he = require('he');
const cheerio = require("cheerio");
const { generateUnsubscribeLink, generateForwardLink } = require('./utils');

function generateHtmlDocument(html, css) {
  return `<!DOCTYPE html><html lang="en"><head> 
      <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="X-UA-Compatible" content="IE=edge"></head>${html}</html>`;
}

const addFooter = (email, campaignId) => {
  const forwardLink = generateForwardLink(campaignId)
  const unsubscribeLink = generateUnsubscribeLink(email,campaignId)
  const footer = `<table width="100%" cellpadding="10" cellspacing="0" style="background-color: #f8f9fa; text-align: center; font-family: Arial, sans-serif; font-size: 12px; color: #666;">
                        <tr>
                            <td>
                                <p>This message was sent to <a href="mailto:${email}" style="color: #007bff; text-decoration: none;">${email}</a></p>
                                <p>Powered by <a href="https://marketermail.com" style="color: #007bff; text-decoration: none;">Marketer Mail</a></p>
                                <p>To ensure delivery, add us to your address book.</p>
                                <p>
                                    <a  target="_blank" href="${unsubscribeLink}" style="color: #dc3545; text-decoration: none;">Unsubscribe</a> |
                                    <a target="_blank" href="${forwardLink}" style="color: #007bff; text-decoration: none;">Forward to a friend</a>
                                </p>
                            </td>
                        </tr>
                    </table>
                    `
  return footer;
}

const createTemplate = (campaignId, htmlcontent, userId, email, components, footeradd = false) => {
  try {
    let footer;
    if (footeradd) {
      footer = addFooter(email, campaignId);
    }
    const encodedHTML = sanitizeHtml(htmlcontent);
    const decodedHTML = he.decode(encodedHTML);
    const jsonobj = JSON.parse(components);
    const layout = jsonobj.layout;
    // Load the decoded HTML into Cheerio
    const $ = cheerio.load(decodedHTML);
    $('[width="700px"]').removeAttr("width");

    // Replace # in href with title attribute value
    $('a[href="#"]').each((_, element) => {
      const titleAttr = $(element).attr('title');
      if (titleAttr) {
        $(element).attr('href', titleAttr);
        $(element).removeAttr('title');
      }
    });

    $('[style*="width: 700px"]').each((_, element) => {
      let style = $(element).attr("style");
      if (style) {
        style = style.replace(/width:\s*700px;?/g, "min-width: 100%;");
        $(element).attr("style", style);
      }
    });


    // Find the first table and append footer inside it as a <tr>
    const firstTable = $("table").first();
    if (firstTable.length && footeradd) {
      firstTable.append(`<tr><td>${footer}</td></tr>`);
    } else if (footeradd) {
      // add footer in body last
      $("body").append(footer);
    }
    //  add width 600px to first table
    $('table').first().attr('align', 'center');

    // Return final HTML
    return he.encode(generateEmailTemplate($.html(), layout))
  } catch (error) {
    logger.info(error)
  }

}

const generateEmailTemplate = (data, layout = {
  "background": "#ffffff",
  "outerBackground": "#f5f5f5",
  "footerBackground": "#f0f0f0",
  "border": "#e0e0e0",
  "borderStyle": "thin"
}) => {
  return `
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
    <html xmlns="http://www.w3.org/1999/xhtml">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Travel Promotion</title>
      <style type="text/css">
        body { margin: 0; padding: 0; min-width: 100%; width: 100% !important; height: 100% !important; }
        body, table, td, div, p, a { -webkit-font-smoothing: antialiased; text-size-adjust: 100%; -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; line-height: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse !important; border-spacing: 0; }
        img { border: 0; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
        .main-container { max-width: 600px; width: 100% !important; margin: 0 auto; }
        @media screen and (max-width: 600px) {
          .img-responsive { width: 100% !important; height: auto !important; }
          .mobile-padding { padding: 10px 5% !important; }
          .mobile-stack { display: block !important; width: 100% !important; }
          .main-container { width: 100% !important; min-width: 320px !important; }
          table.main-container { width: 100% !important; }
          td.container-padding { padding-left: 15px !important; padding-right: 15px !important; }
        }
      </style>
    </head>
    <body bgcolor=${layout.outerBackground} style="margin: 0; padding: 0; background-color: ${layout.outerBackground};>
      <div style="display: none; font-size: 1px; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all;">
        &nbsp;
      </div>
      <center>
        <!--[if mso]>
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" align="center">
        <tr><td>
        <![endif]-->
        <div class="main-container">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: ${layout.background};" bgcolor="${layout.background}">
            <tr>
              <td class="container-padding">
                ${data}
              </td>
            </tr>
          </table>
        </div>
        <!--[if mso]>
        </td></tr>
        </table>
        <![endif]-->
      </center>
    </body>
    </html>
  `;
};

module.exports = {
  createTemplate,
  addFooter,
  generateEmailTemplate
}