const fs = require('fs').promises;
const logger = require('./logger');

const getSymbols = async (symbolsList, symbolsFile) => {
    const _validSymbol = sym => !(sym === '' || sym.includes('/') || sym.startsWith('#'));
	if (symbolsList) {
		let symbols = symbolsList.split(',');
		return symbols;
	} else {
		logger.info(`Reading symbols from file ${symbolsFile}`);
		const data = await fs.readFile(symbolsFile);
		return data.toString().split('\n').filter(_validSymbol);
	}
};

module.exports = {
	getSymbols
};
