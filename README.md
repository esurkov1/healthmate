# HealthChecker - Универсальная библиотека health check'ов

Единая библиотека для создания health check'ов в микросервисах с унифицированным форматом ответа. Полностью совместима с Kubernetes probes.

## Возможности

- ✅ Единый формат ответа для всех микросервисов
- ✅ Поддержка liveness, detailed и readiness проверок
- ✅ Динамическое добавление/удаление компонентов
- ✅ Настройка критичности компонентов
- ✅ Автоматическое кэширование результатов
- ✅ Параллельное выполнение проверок
- ✅ Настраиваемые таймауты
- ✅ Совместимость с Kubernetes probes

## Установка

```bash
# Скопируйте файл HealthChecker.js в ваш проект
cp helpers/HealthChecker.js ./src/helpers/
```

## Быстрый старт

### Базовое использование

```javascript
const HealthChecker = require('./helpers/HealthChecker');
const { db, amqp } = require('./deps');

// Создание экземпляра для микросервиса
const healthChecker = new HealthChecker('payments-service', {
    version: '2.1.0',
    cacheTimeout: 10000 // 10 секунд
});

// Добавление компонентов
healthChecker
    .addComponent('database', async () => {
        try {
            const start = Date.now();
            await db.query('SELECT 1');
            return {
                status: 'healthy',
                details: 'Database connection successful',
                responseTime: Date.now() - start
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                details: 'Database connection failed',
                error: error.message
            };
        }
    }, {
        critical: true,
        timeout: 5000
    })
    .addComponent('rabbitmq', async () => {
        try {
            const isConnected = amqp.isConnected();
            return {
                status: isConnected ? 'healthy' : 'unhealthy',
                details: 'RabbitMQ connection active'
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                details: 'RabbitMQ connection failed',
                error: error.message
            };
        }
    }, {
        critical: true,
        timeout: 3000
    });

// Использование в контроллере
const healthController = {
    liveness: async (req, reply) => {
        const result = await healthChecker.getHealth('liveness');
        return result;
    },

    detailed: async (req, reply) => {
        const result = await healthChecker.getHealth('detailed');
        const statusCode = result.status === 'healthy' ? 200 : 503;
        reply.code(statusCode);
        return result;
    },

    ready: async (req, reply) => {
        try {
            const result = await healthChecker.getHealth('ready');
            return result;
        } catch (error) {
            reply.code(503);
            return {
                status: 'not_ready',
                service: 'payments-service',
                timestamp: new Date().toISOString(),
                error: error.message
            };
        }
    }
};
```

### Кастомные проверки

```javascript
// Добавление кастомной проверки
healthChecker.addComponent('payment-providers', async () => {
    try {
        const providers = await getConfiguredProviders();
        return {
            status: providers.length > 0 ? 'healthy' : 'unhealthy',
            details: `${providers.length} payment providers configured`,
            providers: providers
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            details: 'Failed to check payment providers',
            error: error.message
        };
    }
}, {
    critical: false, // не критический компонент
    timeout: 2000
});

// Проверка с внешним API
healthChecker.addComponent('external-api', async () => {
    try {
        const start = Date.now();
        const response = await fetch('https://api.example.com/health');
        return {
            status: response.ok ? 'healthy' : 'unhealthy',
            details: `External API: ${response.status}`,
            responseTime: Date.now() - start
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            details: 'External API unreachable',
            error: error.message
        };
    }
}, {
    critical: false,
    enabledInReady: false // не включать в readiness check
});
```

## Kubernetes Integration

Библиотека полностью совместима с Kubernetes health checks:

### Deployment Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-service
spec:
  template:
    spec:
      containers:
      - name: payments
        image: payments-service:latest
        ports:
        - containerPort: 3000
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
        # Опционально: startup probe для медленно стартующих приложений
        startupProbe:
          httpGet:
            path: /health
            port: 3000
          periodSeconds: 10
          failureThreshold: 30
```

### Типы проверок в Kubernetes

- **Liveness Probe** → `/health` (liveness) - быстрая проверка что под жив
- **Readiness Probe** → `/health/ready` (ready) - проверка готовности к трафику  
- **Startup Probe** → `/health` (liveness) - проверка при запуске

## Форматы ответов

### Liveness Health Check
```json
{
    "status": "healthy",
    "service": "payments-service",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "version": "2.1.0",
    "uptime": 3600
}
```

### Detailed Health Check
```json
{
    "status": "healthy",
    "service": "payments-service", 
    "timestamp": "2024-01-15T10:30:00.000Z",
    "version": "2.1.0",
    "uptime": 3600,
    "memory": {
        "heapUsed": 45,
        "heapTotal": 128,
        "external": 12,
        "rss": 89,
        "usagePercent": 35,
        "status": "healthy"
    },
    "components": {
        "database": {
            "status": "healthy",
            "details": "Database connection successful",
            "responseTime": 23,
            "critical": true,
            "timeout": 5000
        },
        "rabbitmq": {
            "status": "healthy", 
            "details": "RabbitMQ connection active",
            "critical": true,
            "timeout": 3000
        }
    }
}
```

### Readiness Check
```json
{
    "status": "ready",
    "service": "payments-service",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "criticalComponents": 2
}
```

## Настройки

### Конструктор
```javascript
const healthChecker = new HealthChecker('service-name', {
    version: '1.0.0',           // версия сервиса
    cacheTimeout: 5000,         // время кэширования (мс)
    defaultTimeout: 3000        // таймаут по умолчанию (мс)
});
```

### Опции компонентов
```javascript
healthChecker.addComponent('component-name', checkFunction, {
    critical: true,          // критический компонент (по умолчанию true)
    timeout: 5000,          // таймаут для этого компонента
    enabledInReady: true    // включать в readiness check (по умолчанию true)
});
```

## Интеграция с Fastify

```javascript
// routes/health.js
const HealthChecker = require('../helpers/HealthChecker');

async function healthRoutes(fastify, options) {
    const healthChecker = new HealthChecker('my-service');
    
    fastify.get('/health', async () => {
        return await healthChecker.getHealth('liveness');
    });
    
    fastify.get('/health/detailed', async (request, reply) => {
        const result = await healthChecker.getHealth('detailed');
        reply.code(result.status === 'healthy' ? 200 : 503);
        return result;
    });
    
    fastify.get('/health/ready', async (request, reply) => {
        try {
            return await healthChecker.getHealth('ready');
        } catch (error) {
            reply.code(503);
            return { status: 'not_ready', error: error.message };
        }
    });
}

module.exports = healthRoutes;
```

## Статусы компонентов

- `healthy` - компонент работает нормально
- `unhealthy` - компонент не работает
- `warning` - компонент работает, но есть проблемы
- `degraded` - общий статус при наличии предупреждений

## Общие статусы

- `healthy` - все компоненты здоровы
- `degraded` - есть предупреждения или некритические ошибки
- `unhealthy` - есть критические ошибки
- `ready` - критические компоненты готовы
- `not_ready` - критические компоненты не готовы

## Лучшие практики

1. **Используйте кэширование** - настройте подходящий `cacheTimeout`
2. **Настраивайте таймауты** - не делайте их слишком большими
3. **Отмечайте критичность** - не все компоненты должны быть критическими
4. **Liveness для K8s** - используйте `liveness` для Kubernetes liveness probe
5. **Ready для K8s** - используйте `ready` для Kubernetes readiness probe
6. **Мониторинг памяти** - встроенная проверка памяти всегда включена
7. **Быстрый liveness** - liveness должен быть максимально быстрым без внешних вызовов

## Примеры функций проверок

### Database Check
```javascript
const databaseCheck = async () => {
    try {
        const start = Date.now();
        await db.query('SELECT 1');
        return {
            status: 'healthy',
            details: 'Database connection successful',
            responseTime: Date.now() - start
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            details: 'Database connection failed',
            error: error.message
        };
    }
};

healthChecker.addComponent('database', databaseCheck, { critical: true });
```

### RabbitMQ Check
```javascript
const rabbitmqCheck = async () => {
    try {
        const isConnected = amqp.isConnected();
        return {
            status: isConnected ? 'healthy' : 'unhealthy',
            details: 'RabbitMQ connection status'
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            details: 'RabbitMQ connection failed',
            error: error.message
        };
    }
};

healthChecker.addComponent('rabbitmq', rabbitmqCheck, { critical: true });
```

### Redis Check
```javascript
const redisCheck = async () => {
    try {
        const start = Date.now();
        await redis.ping();
        return {
            status: 'healthy',
            details: 'Redis connection successful',
            responseTime: Date.now() - start
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            details: 'Redis connection failed',
            error: error.message
        };
    }
};

healthChecker.addComponent('redis', redisCheck, { critical: false });
```