export default class FetchRetryError extends Error {
	res: Response;
	url: string;
	statusCode: number;

	constructor(res: Response) {
		super(res.statusText);

		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, FetchRetryError);
		}

		this.res = res;
		this.name = this.constructor.name;
		this.url = res.url;
		this.statusCode = res.status;
	}
}

