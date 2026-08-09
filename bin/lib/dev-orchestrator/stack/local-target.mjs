function loopbackHost(host) {
  return host === 'localhost' || host === '::1' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function proveLocalDatabaseTarget(target, { registeredDockerServices = [] } = {}) {
  if (typeof target?.host !== 'string' || target.host.trim().length === 0) throw new Error('database host is required');
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) throw new Error('database port must be between 1 and 65535');
  if (loopbackHost(target.host)) return { kind: 'loopback', host: target.host, port: target.port };
  const registered = registeredDockerServices.find((service) => (
    typeof service === 'object'
      && service.id === target.dockerServiceId
      && service.host === target.host
      && service.port === target.port
      && service.composeProject === target.composeProject
      && service.composeFile === target.composeFile
      && service.service === target.service
  ));
  if (registered) {
    return {
      kind: 'registered-docker',
      host: target.host,
      port: target.port,
      serviceId: target.dockerServiceId,
      composeProject: target.composeProject,
      composeFile: target.composeFile,
      service: target.service,
    };
  }
  throw new Error(`database target ${target.host}:${target.port} is not proven local`);
}
