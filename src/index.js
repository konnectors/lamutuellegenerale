const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const request = requestFactory({
//  debug: true,
  cheerio: true,
  json: false,
  jar: true
})

const baseUrl = 'https://mon-espace-adherent.lamutuellegenerale.fr'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Fetching the list of documents')
  const $ = await request(`${baseUrl}/EspaceAdherentWebApp/MesDecomptes/Accueil`)

  log('info', 'Parsing list of bills')
  const documents = await parseBills($)

  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields, {
    identifiers: ['books']
  })
}

function authenticate(username, password) {
  return signin({
    url: `${baseUrl}/EspaceAdherentWebApp/Connexion/Identification?ReturnUrl=%2FEspaceAdherentWebApp%2F`,
    formSelector: 'form',
    formData: { Login: username, MotDePasse: password },
    validate: (statusCode, $, fullResponse) => {
      if (statusCode === 200 &&
          fullResponse.request.uri.href === `${baseUrl}/EspaceAdherentWebApp/`) {
        return true
      } else {
        return false
      }
    }
  })
}

async function parseBills($) {
  const bills = []
  // Only keep interesting lines
  const lines = Array.from($('.decomptesTable').find('.decomptesRow.general'))
  let currentPDF = null

  for (let line of lines) {
    const $line = $(line)
    if ($line.hasClass('alt1')) {
      log('debug', `Found a month summary line, saving pdf link`)
      // Extract url part between quotes in href
      currentPDF = baseUrl + $line.find('a').attr('href').split(`'`)[1]
    } else if ($line.hasClass('alt2')) {
      log('debug', `Found a payment line, getting details and making bill`)
      const beneficiary = $line.find('.decomptesCell').eq(0).text()
      const date = parseDate(
        $line.find('.decomptesCell').eq(1).text().match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)[0])
      const isThirdPartyPayer = Boolean($line.find('.decomptesCell').eq(1).text()
                                        .match('aux professionnels de santé'))
      const amount = parseFloat($line.find('.col-montant-total').text()
                                .replace('€', '').replace(',', '.').trim())

      // Getting more details through an ajax request on website
      const detailsLink = baseUrl + $line.find('a').attr('href')
      const $details =  await request(detailsLink)

      // Loop on each bill in details
      const detailsLines = Array.from($details('.decomptesRow.alt2'))
      for (let detailsLine of detailsLines) {
        const $detailsLine = $details(detailsLine)
        const originalDate = $detailsLine.find('.col-date .decomptesValeur').text().trim()
        const subtype = $detailsLine.find('.col-natprest .decomptesValeur').text().trim()
        const originalAmount = parseFloat($detailsLine.find('.col-montant').eq(0)
                                       .find('.decomptesValeur').text()
                                       .replace('€', '').replace(',', '.').trim())
        const socialSecurityRefund = parseFloat($detailsLine.find('.col-montant').eq(1)
                                       .find('.decomptesValeur').text()
                                       .replace('€', '').replace(',', '.').trim())
        const groupAmount = parseFloat($detailsLine.find('.col-montantmutuelle')
                                       .find('.decomptesValeur').text()
                                       .replace('€', '').replace(',', '.').trim())
        const filename = date.getFullYear()
                           + '-' + ('0' + (date.getMonth() + 1)).slice(-2)
                           + '_lamutuellegenerale'
                           + '.pdf'
        const bill = {
          fileurl: currentPDF,
          beneficiary,
          date: date,
          isThirdPartyPayer,
          amount,
          originalDate: parseDate(originalDate),
          subtype,
          originalAmount,
          socialSecurityRefund,
          groupAmount,
          filename,
          vendor: 'lamutuellegenerale',
          type: 'health_costs',
          currency: '€',
          isRefund: true,
          metadata : {
            importDate: new Date(),
            version: 1
          }
        }
        bills.push(bill)
      }
    }
  }
  return bills
}

// Convert a french date to Date object
function parseDate(text) {
  const [d, m, y] = text.split('/', 3).map(e => parseInt(e, 10))
  return new Date(y, m - 1, d)
}
