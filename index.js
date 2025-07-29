class HealthChecker {
    constructor(serviceName, options = {}) {
        this.serviceName = serviceName;
        this.startTime = Date.now();
        this.components = new Map();
        this.cache = new Map();
        this.options = {
            cacheTimeout: options.cacheTimeout || 5000, // 5 секунд по умолчанию
            defaultTimeout: options.defaultTimeout || 3000, // 3 секунды по умолчанию
            version: options.version || '1.0.0',
            ...options
        };
    }

    /**
     * Добавить компонент для проверки
     * @param {string} name - имя компонента
     * @param {Function} checkFunction - функция проверки компонента
     * @param {Object} options - настройки компонента
     * @param {boolean} options.critical - критический ли компонент (по умолчанию true)
     * @param {number} options.timeout - таймаут для проверки (мс)
     * @param {boolean} options.enabledInReady - включен ли в readiness check
     */
    addComponent(name, checkFunction, options = {}) {
        this.components.set(name, {
            name,
            checkFunction,
            critical: options.critical !== false, // по умолчанию критический
            timeout: options.timeout || this.options.defaultTimeout,
            enabledInReady: options.enabledInReady !== false, // по умолчанию включен в ready
            ...options
        });
        return this;
    }

    /**
     * Удалить компонент
     */
    removeComponent(name) {
        this.components.delete(name);
        return this;
    }

    /**
     * Получить статус здоровья
     * @param {string} type - тип проверки: 'liveness', 'detailed', 'ready'
     * @returns {Object} - результат проверки
     */
    async getHealth(type = 'liveness') {
        const cacheKey = `health_${type}`;
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.options.cacheTimeout) {
            return cached.data;
        }

        let result;
        switch (type) {
            case 'detailed':
                result = await this._getDetailedHealth();
                break;
            case 'ready':
                result = await this._getReadinessCheck();
                break;
            default:
                result = this._getLivenessHealth();
        }

        this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
    }   

    /**
     * Liveness проверка для Kubernetes (без async операций)
     */
    _getLivenessHealth() {
        return {
            status: 'healthy',
            service: this.serviceName,
            timestamp: new Date().toISOString(),
            version: this.options.version,
            uptime: Math.floor((Date.now() - this.startTime) / 1000)
        };
    }

    /**
     * Детальная проверка всех компонентов
     */
    async _getDetailedHealth() {
        const componentChecks = [];
        const componentNames = [];

        // Собираем все проверки
        for (const [name, component] of this.components) {
            componentNames.push(name);
            componentChecks.push(
                this._timeoutPromise(
                    component.checkFunction(),
                    component.timeout
                )
            );
        }

        // Выполняем все проверки параллельно
        const results = await Promise.allSettled(componentChecks);
        
        // Обрабатываем результаты
        const components = {};
        componentNames.forEach((name, index) => {
            const component = this.components.get(name);
            components[name] = this._processCheck(results[index], component);
        });

        const overallStatus = this._calculateOverallStatus(components);

        return {
            status: overallStatus,
            service: this.serviceName,
            timestamp: new Date().toISOString(),
            version: this.options.version,
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            memory: this._getMemoryUsage(),
            components
        };
    }

    /**
     * Проверка готовности (только критические компоненты)
     */
    async _getReadinessCheck() {
        const criticalComponents = Array.from(this.components.values())
            .filter(comp => comp.critical && comp.enabledInReady);

        if (criticalComponents.length === 0) {
            return {
                status: 'ready',
                service: this.serviceName,
                timestamp: new Date().toISOString()
            };
        }

        const checks = criticalComponents.map(comp =>
            this._timeoutPromise(comp.checkFunction(), comp.timeout)
        );

        const results = await Promise.allSettled(checks);
        
        // Проверяем, что все критические компоненты здоровы
        const failedChecks = results.filter((result, index) => {
            return result.status === 'rejected' || 
                   (result.status === 'fulfilled' && result.value.status !== 'healthy' && result.value.status !== 'ok');
        });

        if (failedChecks.length > 0) {
            throw new Error(`Critical components not ready: ${failedChecks.length} failed`);
        }

        return {
            status: 'ready',
            service: this.serviceName,
            timestamp: new Date().toISOString(),
            criticalComponents: criticalComponents.length
        };
    }

    /**
     * Вспомогательные методы
     */
    _timeoutPromise(promise, timeout) {
        return Promise.race([
            promise,
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
            )
        ]);
    }

    _processCheck(result, component) {
        const baseInfo = {
            critical: component.critical,
            timeout: component.timeout
        };

        if (result.status === 'fulfilled') {
            return { 
                ...result.value, 
                ...baseInfo
            };
        }

        return {
            status: 'unhealthy',
            error: result.reason.message,
            details: `Check failed: ${result.reason.message}`,
            ...baseInfo
        };
    }

    _calculateOverallStatus(components) {
        const componentList = Object.values(components);
        const hasCriticalError = componentList.some(c => 
            (c.status === 'unhealthy' || c.status === 'error') && c.critical
        );
        const hasAnyError = componentList.some(c => 
            c.status === 'unhealthy' || c.status === 'error'
        );
        const hasWarning = componentList.some(c => 
            c.status === 'warning'
        );
        
        if (hasCriticalError) return 'unhealthy';
        if (hasAnyError || hasWarning) return 'degraded';
        return 'healthy';
    }

    _getMemoryUsage() {
        const { heapUsed, heapTotal, external, rss } = process.memoryUsage();
        const usagePercent = Math.round((heapUsed / heapTotal) * 100);
        
        return {
            heapUsed: Math.round(heapUsed / 1024 / 1024), // MB
            heapTotal: Math.round(heapTotal / 1024 / 1024), // MB
            external: Math.round(external / 1024 / 1024), // MB
            rss: Math.round(rss / 1024 / 1024), // MB
            usagePercent,
            status: usagePercent > 85 ? 'warning' : 'healthy'
        };
    }
}

module.exports = HealthChecker;