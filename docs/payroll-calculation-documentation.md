# HRMS Payroll Calculation Documentation

## Table of Contents
1. [Overview](#overview)
2. [Employee Types](#employee-types)
3. [Hourly Payroll Calculation](#hourly-payroll-calculation)
4. [Monthly Payroll Calculation](#monthly-payroll-calculation)
5. [Common Components](#common-components)
6. [Business Rules](#business-rules)
7. [Examples](#examples)
8. [API Endpoints](#api-endpoints)

---

## Overview

The HRMS system supports two types of payroll calculations based on employee classification:
- **Hourly Employees**: Paid based on actual hours worked with overtime support
- **Monthly Employees**: Paid a fixed monthly salary with deductions for absences

Both types support additional components like incentives, arrears, fine deductions, other deductions, and advanced salary deductions.

---

## Employee Types

### Hourly Employees
- **Base Salary**: `after_probation_gross_salary` (monthly reference)
- **Payment Method**: Actual hours worked × hourly rate + overtime
- **Key Fields**: `payroll_type: "Hourly"`

### Monthly Employees
- **Base Salary**: `after_probation_gross_salary` (monthly salary)
- **Payment Method**: Fixed monthly salary minus absence deductions
- **Key Fields**: `payroll_type: "Monthly"`

---

## Hourly Payroll Calculation

### Base Calculations

#### Core Parameters
```javascript
const workingDays = 26;           // Standard working days per month
const shiftHours = 8;             // Standard shift duration
const perHourRate = grossSalary / (workingDays * shiftHours);
const perMinuteRate = perHourRate / 60;
const perDayRate = grossSalary / workingDays;
```

#### Salary Components
1. **Gross Salary**: Employee's `after_probation_gross_salary`
2. **Actual Gross Salary**: `payableHours × perHourRate`
3. **Per Hour Rate**: `grossSalary ÷ (26 × 8)`
4. **Net Salary**: `actualGrossSalary - lateFines - absentDeductions + overtimePay`

### Daily Processing Logic

#### Working Day Processing
For each attendance record, the system calculates:

1. **Payable Minutes Calculation**:
   ```javascript
   if (record.isOverTime) {
     if (record.overTimeStatus === "Approved") {
       dailyPayableMinutes = record.workDuration - record.overTimeMinutes;
       overtimeMinutes = record.overTimeMinutes;
     } else {
       // Complex logic based on checkin/checkout status
       // See overtime handling section below
     }
   } else {
     dailyPayableMinutes = record.workDuration;
   }
   ```

2. **Daily Pay**: `dailyPayableMinutes × perMinuteRate`

#### Overtime Handling

##### Approved Overtime
- **Regular Employees**: `overtimeMinutes × perMinuteRate`
- **Leadership Roles** (Team Lead, Supervisor, Project Manager):
  - ≤ 60 minutes: `overtimeMinutes × perMinuteRate × 1`
  - > 60 minutes: `overtimeMinutes × perMinuteRate × 2`

##### Pending/Rejected Overtime
Complex calculation based on checkin/checkout status:

1. **Early Checkin + (Early/On-time Checkout)**:
   ```javascript
   payableMinutes = (lastExit - expectedCheckinTime) in minutes
   ```

2. **(Late/On-time Checkin) + Late Checkout**:
   ```javascript
   payableMinutes = (expectedCheckoutTime - firstEntry) in minutes
   ```

3. **Early Checkin + Late Checkout**:
   ```javascript
   payableMinutes = (expectedCheckoutTime - expectedCheckinTime) in minutes
   ```

4. **Fallback**: Use `workDuration`

### Late Fine Calculation

#### Grace Period System
- **First 3 late arrivals**: No fines applied
- **4th and subsequent late arrivals**: Fines applied based on designation

#### Fine Structure

##### Leadership Roles (Team Lead, Supervisor, Project Manager)
```javascript
if (lateMinutes > 120) {
  fine = 4000;  // > 2 hours
} else if (lateMinutes > 20) {
  fine = 2000;  // > 20 minutes
} else if (lateMinutes > 0) {
  fine = 1000;  // > 0 minutes
}
```

##### Regular Employees
```javascript
if (lateMinutes > 120) {
  fine = 2000;  // > 2 hours
} else if (lateMinutes > 20) {
  fine = 1000;  // > 20 minutes
} else if (lateMinutes > 0) {
  fine = 500;   // > 0 minutes
}
```

### Absence Handling

#### Absent Days
- **Status**: `"Absent"`
- **Deduction**: ₹10,000 per absent day (fixed amount)
- **Impact**: No payable hours for that day

#### Missing Workdays
- **Expected**: 26 working days per month
- **Missing Days**: `26 - actualAttendanceRecords`
- **Deduction**: ₹10,000 per missing day

### Final Calculation
```javascript
const finalNetSalary = netSalary + totalIncentives + totalArrears 
                      - totalFineDeductions - totalOtherDeductions 
                      - totalAdvancedSalary;
```

---

## Monthly Payroll Calculation

### Base Calculations

#### Core Parameters
```javascript
const grossSalary = employee.after_probation_gross_salary;
const workingDaysInMonth = 26;
const perDayDeduction = grossSalary / workingDaysInMonth;
```

### Daily Processing Logic

#### Working Day Processing
For each attendance record:

1. **Present Day**: Full pay (no deduction)
2. **Absent Day**: 
   ```javascript
   dailyDeduction = grossSalary / 26;
   absentDeductions += dailyDeduction;
   ```

### Absence Handling
- **Status Check**: Only `"Absent"` status triggers deduction
- **Per Day Deduction**: `grossSalary ÷ 26`
- **Total Deduction**: `absentDays × perDayDeduction`

### Final Calculation
```javascript
const finalNetSalary = grossSalary - absentDeductions + totalIncentives 
                      + totalArrears - totalFineDeductions 
                      - totalOtherDeductions - totalAdvancedSalary;
```

---

## Common Components

### Additional Salary Components

#### 1. Other Incentives
- **Source**: `OtherIncentive` model
- **Filter**: `processed: false` within date range
- **Impact**: Added to net salary
- **Status**: Only approved incentives are included

#### 2. Arrears
- **Source**: `Arrears` model
- **Filter**: `processed: false` within date range
- **Impact**: Added to net salary
- **Status**: Only approved arrears are included

#### 3. Fine Deductions
- **Source**: `FineDeduction` model
- **Filter**: `processed: false` within date range
- **Impact**: Subtracted from net salary
- **Status**: Only approved deductions are included

#### 4. Other Deductions
- **Source**: `OtherDeduction` model
- **Filter**: `processed: false` within date range
- **Impact**: Subtracted from net salary
- **Status**: Only approved deductions are included

#### 5. Advanced Salary
- **Source**: `AdvancedSalary` model
- **Filter**: `status: "Approved"` and `processed: false`
- **Impact**: Subtracted from net salary
- **Amount**: Uses `approvedAmount` field

### Processing Status
After payroll generation, all included records are marked as `processed: true` to prevent double-counting in future payrolls.

---

## Business Rules

### 1. Working Days Standard
- **Monthly Standard**: 26 working days
- **Daily Shift**: 8 hours
- **Monthly Hours**: 208 hours (26 × 8)

### 2. Overtime Rules
- **Approval Required**: Overtime must be approved for full rate
- **Leadership Premium**: Leaders get double rate for >60 min overtime
- **Pending/Rejected**: Calculated based on expected vs actual times

### 3. Late Fine Exemptions
- **Grace Period**: First 3 late arrivals per period are free
- **Working Days Only**: Fines only apply to Present/Late status days
- **Progressive Structure**: Higher fines for longer delays

### 4. Absence Policies
- **Hourly**: Fixed ₹10,000 deduction per absent day
- **Monthly**: Proportional deduction (salary ÷ 26 per day)

### 5. Payroll Generation Rules
- **Duplicate Prevention**: Cannot generate payroll for same employee and date range
- **Date Range Validation**: Start and end dates are required
- **Employee Filtering**: Can generate for specific employees or all

---

## Examples

### Example 1: Hourly Employee (Regular)

**Employee Details:**
- Name: John Doe
- Gross Salary: ₹52,000/month
- Type: Hourly (Regular Employee)
- Period: Jan 1-31, 2024

**Calculations:**
```javascript
perHourRate = 52000 / (26 × 8) = ₹250/hour
perMinuteRate = 250 / 60 = ₹4.17/minute
```

**Daily Breakdown:**
- Day 1: 8 hours work = 480 min × ₹4.17 = ₹2,000
- Day 2: Late 25 min (5th late arrival) = 480 min × ₹4.17 - ₹500 fine = ₹1,500
- Day 3: Overtime 60 min approved = 480 min × ₹4.17 + 60 min × ₹4.17 = ₹2,250
- Day 4: Absent = ₹0 - ₹10,000 deduction = -₹10,000

**Final Calculation:**
- Actual Gross: 180 hours × ₹250 = ₹45,000
- Late Fines: ₹2,000
- Absent Deductions: ₹20,000
- Overtime Pay: ₹5,000
- Net Salary: ₹45,000 - ₹2,000 - ₹20,000 + ₹5,000 = ₹28,000

### Example 2: Monthly Employee

**Employee Details:**
- Name: Jane Smith
- Gross Salary: ₹60,000/month
- Type: Monthly
- Period: Jan 1-31, 2024

**Calculations:**
```javascript
perDayDeduction = 60000 / 26 = ₹2,308/day
```

**Attendance:**
- Present Days: 24
- Absent Days: 2

**Final Calculation:**
- Gross Salary: ₹60,000
- Absent Deductions: 2 × ₹2,308 = ₹4,616
- Net Salary: ₹60,000 - ₹4,616 = ₹55,384

---

## API Endpoints

### Hourly Payroll
- `POST /api/payroll/hourly/generate` - Generate hourly payroll
- `GET /api/payroll/hourly` - List hourly payrolls
- `GET /api/payroll/hourly/:id` - Get specific hourly payroll
- `PUT /api/payroll/hourly/:id` - Update hourly payroll
- `DELETE /api/payroll/hourly/:id` - Delete hourly payroll
- `GET /api/payroll/hourly/:id/payslip` - Get hourly payslip

### Monthly Payroll
- `POST /api/payroll/monthly/generate` - Generate monthly payroll
- `GET /api/payroll/monthly` - List monthly payrolls
- `GET /api/payroll/monthly/:id` - Get specific monthly payroll
- `PUT /api/payroll/monthly/:id` - Update monthly payroll
- `DELETE /api/payroll/monthly/:id` - Delete monthly payroll
- `GET /api/payroll/monthly/:id/payslip` - Get monthly payslip

### Combined
- `GET /api/payroll/all` - List all payrolls (both types)

### Unprocessed Records
- `GET /api/payroll/unprocessed/incentives` - Get unprocessed incentives
- `GET /api/payroll/unprocessed/arrears` - Get unprocessed arrears
- `GET /api/payroll/unprocessed/fine-deductions` - Get unprocessed fine deductions
- `GET /api/payroll/unprocessed/other-deductions` - Get unprocessed other deductions
- `GET /api/payroll/unprocessed/advanced-salaries` - Get unprocessed advanced salaries

---

## Data Models

### PayrollHourly Schema
```javascript
{
  employeeId: ObjectId,
  employeeName: String,
  designation: String,
  startDate: Date,
  endDate: Date,
  grossSalary: Number,           // Monthly reference salary
  actualGrossSalary: Number,     // Based on hours worked
  perHourRate: Number,
  payableHours: Number,
  lateFines: Number,
  absentDays: Number,
  absentDeductions: Number,
  overtimePay: Number,
  otherIncentives: Number,
  otherDeductions: Number,
  fineDeductions: Number,
  advancedSalary: Number,
  netSalary: Number,
  dailyCalculations: Array,
  status: String
}
```

### PayrollMonthly Schema
```javascript
{
  employeeId: ObjectId,
  employeeName: String,
  designation: String,
  startDate: Date,
  endDate: Date,
  grossSalary: Number,
  absentDays: Number,
  absentDeductions: Number,
  otherIncentives: Number,
  otherDeductions: Number,
  fineDeductions: Number,
  advancedSalary: Number,
  netSalary: Number,
  dailyCalculations: Array,
  status: String
}
```

---

## Notes

1. **Currency**: All amounts are in Indian Rupees (₹)
2. **Precision**: Calculations maintain precision using proper decimal handling
3. **Audit Trail**: Daily calculations provide detailed breakdown for transparency
4. **Status Tracking**: All additional components track processing status
5. **Error Handling**: Comprehensive validation and error reporting
6. **Performance**: Optimized queries with proper indexing

---

*Last Updated: December 2024*
*Version: 1.0* 