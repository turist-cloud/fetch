export default class FetchRetryError extends Error {
	url: string;
	statusCode: number;

	constructor(url: string, statusCode: number, statusText: string) {
		super(statusText);
		this.url = url;
		this.statusCode = statusCode;
	}
}

