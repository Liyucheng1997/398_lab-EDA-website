`timescale 1ns / 1ps

// 对多种占空比统计每个 PWM 周期内的高电平拍数
module tb;
  localparam W = 6;  // 周期 64 拍，仿真更快

  logic         clk = 0, rst = 1;
  logic [W-1:0] duty = 0;
  logic         pwm_out, period_start;
  integer       errors = 0;

  pwm #(.W(W)) dut (.clk(clk), .rst(rst), .duty(duty), .pwm_out(pwm_out), .period_start(period_start));

  always #5 clk = ~clk;

  // 设置占空比，跳过一个周期让它生效，然后统计一个完整周期
  task automatic check_duty(input integer d);
    integer high;
    duty = d[W-1:0];
    // 等两个周期起点：第一个周期可能仍在使用旧值，第二个一定已锁存新值
    repeat (2) begin
      do @(negedge clk); while (!period_start);
    end
    high = 0;
    repeat (1 << W) begin
      if (pwm_out) high = high + 1;
      @(negedge clk);
    end
    $display("duty = %2d -> 高电平 %2d/%0d 拍（%0d%%）", d, high, 1 << W, high * 100 / (1 << W));
    if (high != d) begin
      $display("  错误：期望 %0d", d);
      errors = errors + 1;
    end
  endtask

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);
    repeat (2) @(negedge clk);
    rst = 0;

    check_duty(0);
    check_duty(1);
    check_duty(16);
    check_duty(32);
    check_duty(48);
    check_duty(63);

    if (errors == 0) $display("PASS: PWM 占空比全部正确");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
