const axios = require('axios')
const AWS = require('aws-sdk')
const request = require('request')
const s3 = new AWS.S3()
const mammoth = require('mammoth')
require('dotenv').config()

const apiKey = process.env.API_KEY
const s3Bucket = process.env.S3_BUCKET
const freshenUrl = process.env.FRESHEN_URL
const tariffDocsUrl = process.env.TARIFF_DOCS_URL
const accessTokenUrl = process.env.ACCESS_TOKEN_URL
const clientId = process.env.CLIENT_ID
const clientSecret = process.env.CLIENT_SECRET

const getAccessToken = async () => {
  const params = {
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    resource: clientId
  }

  const tokenResponse = await axios(
    {
      method: 'POST',
      url: accessTokenUrl,
      ContentType: 'application/x-www-form-urlencoded',
      data: buildHttpQuery(params)
    }).catch(err => {
    console.log(err.message)
  })

  return tokenResponse.data.access_token
}

const retrieveAndSaveTariffDocs = async (accessToken) => {
  const tariffDocsResponse = await axios({
    method: 'GET',
    url: tariffDocsUrl,
    ContentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      CacheControl: 'no-cache'
    },
    data: {
      query: "$filter=Publication eq 'FTA Publication'"
    }
  }).catch(err => {
    console.log(err.message)
  })

  let metaDataPromises = tariffDocsResponse.data.map(async tariffDocMetaData => {
    let url = tariffDocMetaData.metadata_storage_path
    if (url.endsWith('.docx')) {
      let fileContent = await axios(url, { responseType: 'arraybuffer' })
      let fileContentText = await mammoth.extractRawText({ buffer: fileContent.data })
      return { url, content: fileContentText.value }
    }
  })

  let metaDataRawTexts = await Promise.all(metaDataPromises)
  tariffDocsResponse.data.map(r => {
    const tmp = metaDataRawTexts.find(file => file && file.url === r.metadata_storage_path)
    r.content = tmp ? tmp.content : null
  })

  writeToBucket(tariffDocsResponse.data)
}

const writeToBucket = (entries) => {
  const params = {
    Body: JSON.stringify(entries, null, 2),
    Bucket: s3Bucket,
    Key: 'tariff_docs.json',
    ACL: 'public-read',
    ContentType: 'application/json'
  }

  s3.putObject(params, function (err, data) {
    if (err) { return console.error(err) }
    console.log('File uploaded successfully!')
    freshenEndpoint()
  })
}

const freshenEndpoint = () => {
  request(freshenUrl + apiKey, function (err, res, body) {
    if (err || (res && res.statusCode !== 200)) return console.error(`An error occurred while freshening the endpoint. ${body}`)
    console.log('Endpoint updated successfully!')
  })
}

const buildHttpQuery = (params) => {
  if (typeof params === 'undefined' || typeof params !== 'object') {
    params = {}
    return params
  }

  var query = ''
  var index = 0

  for (var i in params) {
    index++
    var param = i
    var value = params[i]
    if (index === 1) {
      query += param + '=' + value
    } else {
      query += '&' + param + '=' + value
    }
  }

  return query
}

// For development/testing purposes
exports.handler = function (event, context) {
  getAccessToken().then(accessToken => {
    retrieveAndSaveTariffDocs(accessToken)
  })
}
