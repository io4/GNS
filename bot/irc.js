const events = require('events');
const Events = require('./irc/events');
const Parser = require('irc-stream-parser');
const tls = require('tls');
const { readFileSync } = require('fs');
const { Application } = require('probot'); // eslint-disable-line no-unused-vars
const PouchDB = require('pouchdb');

// Config DB
const db = new PouchDB(process.env.POUCH_REMOTE);

/**
* Strips formatting from IRC messages
* @param {string} msg
* @return {string}
*/
function strip_formatting(msg) {
  /* eslint-disable no-control-regex */
  let ccodes = ['\\x0f', '\\x16', '\\x1d', '\\x1f', '\\x02', '\\x03([0-9][0-6]?)?,?([0-9][0-6]?)?'];
  /* eslint-enable no-control-regex */

  for (let cc of ccodes)
    msg = msg.replace(new RegExp(cc, 'g'), '');

  return msg;
}

/**
 * IRC connection wrapper
 */
class IRC extends Events {

  /**
  * @param {Application} app
  * @param {String} org
  */
  constructor(app, org) {
    super();
    this.app = app;
    this.org = org;
    this.app.log(org);
  }

  /**
   * @async
   * Initialiser function, since the constructor cannot be async
   */
  async init() {
    this.config = (await db.get(this.org)).config;

    let { server, port, bindhost, sasl } = this.config.irc;

    this.socket = tls.connect(port, server, {
      localaddress: bindhost,
      cert: sasl.cert ? readFileSync(sasl.cert) : null,
      key: sasl.key ? readFileSync(sasl.key): null,
      passphrase: sasl.key_passphrase
    });

    this.parser = new Parser();
    this.irc_events = new events.EventEmitter();
    super.init(this);

    this.socket.on('connect', () => {
      let { nickname, ident, realname } = this.config.irc;

      this.app.log.info('Connected to IRC');
      this.write('CAP LS');
      this.write(`NICK ${nickname}`);
      this.write(`USER ${ident} 0 * :${realname}`);
    }).pipe(this.parser).on('data', data => {
      this.app.log.debug(`>>> ${strip_formatting(data.raw)}`);
      this.irc_events.emit(data.command, this, data);
      this.irc_events.emit(data.numeric, this, data);
    });
  }

  /**
  * @param {string} message
  */
  write(message) {
    this.socket.write(`${message}\r\n`);
    this.app.log.debug(`<<< ${strip_formatting(message)}`);
  }

  /**
    * @param {string} text The text to send to the server
    */
  privmsg(text) {
    let method = this.config.irc.notice ? 'NOTICE' : 'PRIVMSG';

    this.write(`${method} ${this.config.irc.channel} :${text}`);
  }

}

module.exports = IRC;
